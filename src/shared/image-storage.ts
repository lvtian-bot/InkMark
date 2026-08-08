export type StoreImageRequest = {
  documentPath: string | null;
  data: Uint8Array;
  fileName: string;
};

export type StoreImageResult =
  | { status: 'ok'; relativePath: string }
  | {
      status: 'error';
      code:
        | 'document-not-saved'
        | 'invalid-request'
        | 'invalid-document-path'
        | 'empty-image'
        | 'image-too-large'
        | 'unsupported-image-type'
        | 'storage-failed';
      message: string;
    };

export type ResolveImageSourceRequest = {
  documentPath: string | null;
  source: string;
};

export type ResolveImageSourceResult =
  | { status: 'ok'; url: string }
  | {
      status: 'error';
      code: 'invalid-source' | 'document-not-saved' | 'source-not-found';
      message: string;
    };

export type DiscardStoredImageRequest = {
  documentPath: string;
  relativePath: string;
};

export type DiscardStoredImageResult = { status: 'ok' } | { status: 'error'; message: string };
