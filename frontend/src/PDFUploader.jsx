// PDFUploader.jsx
//
// Landing screen: lets the user drag-and-drop or pick a PDF, then POSTs it
// to the FastAPI backend's /upload endpoint. On success, the parent (App)
// opens the WebSocket and starts the reading session.

import { useRef, useState } from 'react';

export default function PDFUploader({ backendUrl, onUploaded }) {
  const [isDragging, setIsDragging] = useState(false);
  const [status, setStatus] = useState('idle'); // idle | uploading | error
  const [errorMessage, setErrorMessage] = useState('');
  const fileInputRef = useRef(null);

  async function uploadFile(file) {
    if (!file || file.type !== 'application/pdf') {
      setStatus('error');
      setErrorMessage('Please choose a PDF file.');
      return;
    }

    setStatus('uploading');
    setErrorMessage('');

    const formData = new FormData();
    formData.append('file', file);

    try {
      const response = await fetch(`${backendUrl}/upload`, {
        method: 'POST',
        body: formData,
      });
      if (!response.ok) {
        throw new Error(`Upload failed (${response.status})`);
      }
      const data = await response.json();
      onUploaded(data);
    } catch (err) {
      setStatus('error');
      setErrorMessage(err.message || 'Upload failed.');
    }
  }

  // Visual state for the drop zone: drag-active takes priority over the
  // upload status, so the border/shadow react immediately to a file being
  // dragged over regardless of what happened before.
  const dropZoneState = isDragging ? 'drag' : status; // 'drag' | 'idle' | 'uploading' | 'error'

  const dropZoneStyles = {
    idle: 'border-border bg-cardBg shadow-brutal hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-brutal-lg',
    drag: '-translate-x-0.5 -translate-y-0.5 border-teal bg-cardBg shadow-brutal-lg',
    uploading: 'cursor-wait border-yellow bg-cardBg shadow-brutal-sm',
    error: 'border-primary bg-cardBg shadow-brutal',
  };

  return (
    <div className="flex w-full max-w-lg flex-col items-center gap-6 text-center">
      <div>
        <h1 className="text-4xl font-extrabold text-text">Braille Reader</h1>
        <p className="mt-2 max-w-md text-subtext">
          Upload a PDF. It will be read aloud word by word and embossed live on the
          physical Braille display.
        </p>
      </div>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragging(false);
          uploadFile(e.dataTransfer.files?.[0]);
        }}
        onClick={() => {
          if (window.electronAPI) {
            window.electronAPI.openPDFDialog().then((file) => {
              if (file) uploadFile(new File([file.data], file.name, { type: 'application/pdf' }));
            });
          } else {
            fileInputRef.current?.click();
          }
        }}
        className={
          'flex h-64 w-full cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-3 p-6 transition-all ' +
          dropZoneStyles[dropZoneState]
        }
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf"
          className="hidden"
          onChange={(e) => uploadFile(e.target.files?.[0])}
        />
        {status === 'uploading' ? (
          <p className="text-xl font-bold text-text">Uploading…</p>
        ) : isDragging ? (
          <p className="text-xl font-bold text-text">Drop it here</p>
        ) : (
          <p className="text-xl font-semibold text-subtext">Drop a PDF here, or click to select one</p>
        )}
      </div>

      {status === 'error' && (
        <p className="rounded-lg border-3 border-primary bg-cardBg px-4 py-2 font-semibold text-primary">
          {errorMessage}
        </p>
      )}
    </div>
  );
}
