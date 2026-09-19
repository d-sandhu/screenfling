import { useEffect, useRef, useState } from "react";

import type { CaptureDraft } from "../../shared/capture";

import "./preview-viewport.css";

// Presentation only: zoom reuses the loaded JPEG preview and never changes the crop.
export function PreviewViewport({
  imageUrl,
  pixels,
  onReady,
  onError,
}: {
  readonly imageUrl: string;
  readonly pixels: CaptureDraft["pixels"];
  readonly onReady: () => void;
  readonly onError: () => void;
}) {
  const [actualSize, setActualSize] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const viewport = useRef<HTMLDivElement>(null);
  const fitButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const element = viewport.current;
    if (element === null) return;
    element.scrollTo(0, 0);
    if (actualSize) element.focus();
  }, [actualSize]);

  return (
    <figure
      className={`preview preview--inspectable${actualSize ? " preview--actual" : ""}`}
      onKeyDown={(event) => {
        if (
          !actualSize || event.key !== "Escape" || event.repeat || event.defaultPrevented ||
          event.nativeEvent.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey
        ) return;
        // The first Escape inside an enlarged preview fits it, not cancels the capture.
        event.preventDefault();
        event.stopPropagation();
        setActualSize(false);
        fitButton.current?.focus();
      }}
    >
      <figcaption className="preview__toolbar">
        <span>{pixels.width} × {pixels.height} px</span>
        <div className="preview__zoom" role="group" aria-label="Preview zoom">
          <button
            type="button" ref={fitButton} disabled={!loaded} aria-pressed={!actualSize}
            onClick={() => setActualSize(false)}
          >Fit</button>
          <button
            type="button" disabled={!loaded} aria-pressed={actualSize}
            title="One image pixel per CSS pixel; scroll to inspect"
            onClick={() => setActualSize(true)}
          >100%</button>
        </div>
      </figcaption>
      <div
        ref={viewport} className="preview__viewport" tabIndex={actualSize ? 0 : -1}
        role="region"
        aria-label={actualSize
          ? "Full-size preview. Scroll to inspect; Escape fits the image."
          : "Fitted capture preview"}
      >
        <img
          alt="Selected screen region"
          draggable={false}
          style={actualSize ? { width: pixels.width, height: pixels.height } : undefined}
          onLoad={(event) => {
            const image = event.currentTarget;
            if (image.naturalWidth !== pixels.width || image.naturalHeight !== pixels.height) {
              onError();
              return;
            }
            setLoaded(true);
            onReady();
          }}
          onError={onError}
          src={imageUrl}
        />
      </div>
    </figure>
  );
}
