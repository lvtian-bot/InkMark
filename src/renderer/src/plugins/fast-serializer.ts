import { remarkCtx, schemaCtx, serializerCtx, SerializerReady } from '@milkdown/kit/core';
import type { MilkdownPlugin } from '@milkdown/kit/ctx';
import { serializerMatchError } from '@milkdown/kit/exception';
import {
  Mark,
  type Fragment,
  type MarkType,
  type Node,
  type NodeType,
  type Schema,
} from '@milkdown/kit/prose/model';
import {
  Stack,
  StackElement,
  type JSONRecord,
  type MarkdownNode,
  type RemarkParser,
  type Serializer,
  type SerializerState,
} from '@milkdown/kit/transformer';

type NodeWithSerializer = NodeType & {
  spec: {
    toMarkdown: {
      match: (node: Node) => boolean;
      runner: (state: SerializerState, node: Node) => void;
    };
  };
};

type MarkWithSerializer = MarkType & {
  spec: {
    toMarkdown: {
      match: (mark: Mark) => boolean;
      runner: (state: SerializerState, mark: Mark, node: Node) => void | boolean;
    };
    priority?: number;
  };
};

class FastSerializerStackElement extends StackElement<MarkdownNode> {
  type: string;
  children?: MarkdownNode[];
  value?: string;
  props: JSONRecord;

  constructor(type: string, children?: MarkdownNode[], value?: string, props: JSONRecord = {}) {
    super();
    this.type = type;
    this.children = children;
    this.value = value;
    this.props = props;
  }

  static create(
    type: string,
    children?: MarkdownNode[],
    value?: string,
    props: JSONRecord = {},
  ): FastSerializerStackElement {
    return new FastSerializerStackElement(type, children, value, props);
  }

  push = (node: MarkdownNode, ...rest: MarkdownNode[]): void => {
    if (!this.children) this.children = [];
    this.children.push(node, ...rest);
  };

  pop = (): MarkdownNode | undefined => this.children?.pop();
}

function isFragment(x: Node | Fragment): x is Fragment {
  return Object.prototype.hasOwnProperty.call(x, 'size');
}

/**
 * 线性复杂度的 Milkdown 序列化实现：替代上游 `@milkdown/transformer` 的
 * `SerializerState`（其 `#maybeMergeChildren` 在归约中反复 `concat` 导致 O(N²)，
 * 且每次匹配节点都重新展开 schema 对象）。对外语义与栈结构保持兼容。
 */
export class FastSerializerState extends Stack<MarkdownNode, FastSerializerStackElement> {
  readonly schema: Schema;
  private openMarks: Array<{ mark: Mark; spanning: boolean }> = [];
  private readonly nodeSpecs: NodeWithSerializer[];
  private readonly markSpecs: MarkWithSerializer[];

  constructor(schema: Schema) {
    super();
    this.schema = schema;
    this.nodeSpecs = Object.values(schema.nodes) as unknown as NodeWithSerializer[];
    this.markSpecs = Object.values(schema.marks) as unknown as MarkWithSerializer[];
  }

  private asSerializerState(): SerializerState {
    return this as unknown as SerializerState;
  }

  private matchNodeTarget(node: Node): NodeWithSerializer {
    for (const spec of this.nodeSpecs) {
      if (spec.spec.toMarkdown.match(node)) return spec;
    }
    throw serializerMatchError(node.type);
  }

  private matchMarkTarget(mark: Mark): MarkWithSerializer {
    for (const spec of this.markSpecs) {
      if (spec.spec.toMarkdown.match(mark)) return spec;
    }
    throw serializerMatchError(mark.type);
  }

  private runProseNode(node: Node): void {
    this.matchNodeTarget(node).spec.toMarkdown.runner(this.asSerializerState(), node);
  }

  private runProseMark(mark: Mark, node: Node): void | boolean {
    return this.matchMarkTarget(mark).spec.toMarkdown.runner(this.asSerializerState(), mark, node);
  }

  private orderMarks(marks: readonly Mark[]): Mark[] {
    const getPriority = (x: Mark): number => (x.type.spec as { priority?: number }).priority ?? 50;
    const rest = [...marks].sort((a, b) => getPriority(a) - getPriority(b));
    const continuing: Mark[] = [];
    this.openMarks.forEach(({ mark }) => {
      const index = rest.findIndex((x) => x.eq(mark));
      if (index >= 0) continuing.push(...rest.splice(index, 1));
    });
    return continuing.concat(rest);
  }

  private closeEndedMarks(next?: Node): void {
    const nextMarks = next?.marks;
    let keep = 0;
    while (keep < this.openMarks.length) {
      const { mark, spanning } = this.openMarks[keep];
      if (spanning && nextMarks?.some((x) => x.eq(mark))) keep += 1;
      else break;
    }
    for (let i = this.openMarks.length - 1; i >= keep; i -= 1) {
      this.closeMarkInternal(this.openMarks[i].mark);
    }
  }

  private runNode(node: Node, next?: Node): void {
    if (this.orderMarks(node.marks).every((mark) => !this.runProseMark(mark, node))) {
      this.runProseNode(node);
    }
    this.closeEndedMarks(next);
  }

  private maybeMergeChildren(node: MarkdownNode): MarkdownNode {
    const { children } = node;
    if (!children || children.length <= 1) return node;
    const nextChildren: MarkdownNode[] = [children[0]];
    for (let index = 1; index < children.length; index += 1) {
      const child = children[index];
      const last = nextChildren[nextChildren.length - 1];
      if (last && last.isMark && child.isMark) {
        const { children: currChildren, ...currRest } = child;
        const { children: prevChildren, ...prevRest } = last;
        if (
          child.type === last.type &&
          currChildren &&
          prevChildren &&
          JSON.stringify(currRest) === JSON.stringify(prevRest)
        ) {
          const merged: MarkdownNode = {
            ...prevRest,
            type: last.type,
            children: [...prevChildren, ...currChildren],
          };
          nextChildren[nextChildren.length - 1] = this.maybeMergeChildren(merged);
          continue;
        }
      }
      nextChildren.push(child);
    }
    node.children = nextChildren;
    return node;
  }

  private createMarkdownNode(element: FastSerializerStackElement): MarkdownNode {
    const node: MarkdownNode = {
      ...element.props,
      type: element.type,
    };
    if (element.children) node.children = element.children;
    if (element.value) node.value = element.value;
    return node;
  }

  private addNodeAndPush(
    type: string,
    children?: MarkdownNode[],
    value?: string,
    props?: JSONRecord,
  ): MarkdownNode {
    const element = FastSerializerStackElement.create(type, children, value, props);
    const node = this.maybeMergeChildren(this.createMarkdownNode(element));
    this.push(node);
    return node;
  }

  private moveSpaces(
    element: FastSerializerStackElement,
    onPush: () => MarkdownNode,
  ): MarkdownNode {
    let startSpaces = '';
    let endSpaces = '';
    const children = element.children;
    if (children) {
      const firstChild = children[0];
      const lastChild = children.at(-1);
      if (
        lastChild &&
        lastChild.type === 'text' &&
        typeof lastChild.value === 'string' &&
        lastChild.value.endsWith(' ')
      ) {
        const text = lastChild.value;
        const trimmed = text.trimEnd();
        endSpaces = text.slice(trimmed.length);
        lastChild.value = trimmed;
      }
      if (
        firstChild &&
        firstChild.type === 'text' &&
        typeof firstChild.value === 'string' &&
        firstChild.value.startsWith(' ')
      ) {
        const text = firstChild.value;
        const trimmed = text.trimStart();
        startSpaces = text.slice(0, text.length - trimmed.length);
        firstChild.value = trimmed;
      }
    }
    if (startSpaces.length) this.addNodeAndPush('text', undefined, startSpaces);
    const result = onPush();
    if (endSpaces.length) this.addNodeAndPush('text', undefined, endSpaces);
    return result;
  }

  private closeNodeAndPush(trim = false): MarkdownNode {
    const element = this.close();
    const onPush = (): MarkdownNode =>
      this.addNodeAndPush(element.type, element.children, element.value, element.props);
    if (trim) return this.moveSpaces(element, onPush);
    return onPush();
  }

  private openMarkInternal(mark: Mark, type: string, value?: string, props?: JSONRecord): this {
    if (this.openMarks.some((x) => x.mark.eq(mark))) return this;
    this.openMarks.push({
      mark,
      spanning: value == null,
    });
    return this.openNode(type, value, {
      ...props,
      isMark: true,
    });
  }

  private closeMarkInternal(mark: Mark): void {
    let index = -1;
    for (let i = this.openMarks.length - 1; i >= 0; i -= 1) {
      if (this.openMarks[i].mark.eq(mark)) {
        index = i;
        break;
      }
    }
    if (index < 0) return;
    this.openMarks.splice(index, 1);
    this.closeNodeAndPush(true);
  }

  openNode = (type: string, value?: string, props?: JSONRecord): this => {
    this.open(FastSerializerStackElement.create(type, undefined, value, props));
    return this;
  };

  closeNode = (): this => {
    this.closeNodeAndPush();
    return this;
  };

  addNode = (type: string, children?: MarkdownNode[], value?: string, props?: JSONRecord): this => {
    this.addNodeAndPush(type, children, value, props);
    return this;
  };

  withMark = (mark: Mark, type: string, value?: string, props?: JSONRecord): this =>
    this.openMarkInternal(mark, type, value, props);

  closeMark = (mark: Mark): this => {
    this.closeMarkInternal(mark);
    return this;
  };

  build = (): MarkdownNode => {
    let doc: MarkdownNode;
    do {
      doc = this.closeNodeAndPush();
    } while (this.size());
    return doc;
  };

  next = (nodes: Node | Fragment): this => {
    if (isFragment(nodes)) {
      nodes.forEach((node, _offset, index) => {
        this.runNode(node, nodes.maybeChild(index + 1) ?? undefined);
      });
      return this;
    }
    this.runNode(nodes);
    return this;
  };

  run = (tree: Node): this => {
    this.openMarks = [];
    this.next(tree);
    return this;
  };

  toString = (remark: RemarkParser): string =>
    remark.stringify(this.build() as Parameters<RemarkParser['stringify']>[0]);
}

export function createFastSerializer(schema: Schema, remark: RemarkParser): Serializer {
  return (content: Node) => {
    const state = new FastSerializerState(schema);
    state.run(content);
    return state.toString(remark);
  };
}

export const fastSerializer: MilkdownPlugin = (ctx) => async () => {
  await ctx.wait(SerializerReady);
  const remark = ctx.get(remarkCtx);
  const schema = ctx.get(schemaCtx);
  ctx.set(serializerCtx, createFastSerializer(schema, remark));
};
