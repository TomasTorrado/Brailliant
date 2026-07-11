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

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
      <h1 className="text-4xl font-semibold">Braille Reader</h1>
      <p className="max-w-md text-center text-neutral-400">
        Upload a PDF. It will be read aloud word by word and embossed live on the
        physical Braille display.
      </p>

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
          'flex h-64 w-full max-w-lg cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed transition-colors ' +
          (isDragging ? 'border-emerald-400 bg-neutral-900' : 'border-neutral-700 bg-neutral-950 hover:border-neutral-500')
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
          <p className="text-xl text-neutral-300">Uploading…</p>
        ) : (
          <p className="text-xl text-neutral-400">Drop a PDF here, or click to select one</p>
        )}
      </div>

      {status === 'error' && <p className="text-red-400">{errorMessage}</p>}
    </div>
  );
}
