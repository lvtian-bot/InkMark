import { forwardRef } from 'react';
import { useStore } from '../stores/useStore';
import '../styles/editor.css';

interface SourceEditorProps {
  onChange: () => void;
}

export const SourceEditor = forwardRef<HTMLTextAreaElement, SourceEditorProps>(
  function SourceEditor({ onChange }, ref) {
    const contentTheme = useStore((s) => s.contentTheme);
    return (
      <div className={`source-container theme-${contentTheme}`}>
        <textarea
          ref={ref}
          className="source-textarea"
          spellCheck={false}
          onChange={onChange}
          placeholder={'\u5728\u6b64\u8f93\u5165 Markdown \u6e90\u7801...'}
        />
      </div>
    );
  },
);
