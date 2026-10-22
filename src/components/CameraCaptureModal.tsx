import React, { useEffect, useRef, useState } from "react";
import { Camera, X, RefreshCw } from "lucide-react";

interface CameraCaptureModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCaptureFile: (file: File) => void;
}

export const CameraCaptureModal: React.FC<CameraCaptureModalProps> = ({
  isOpen,
  onClose,
  onCaptureFile,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [facingMode, setFacingMode] = useState<"environment" | "user">("environment");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) {
      if (stream) {
        stream.getTracks().forEach((t) => t.stop());
        setStream(null);
      }
      return;
    }

    let activeStream: MediaStream | null = null;
    setError(null);

    navigator.mediaDevices
      ?.getUserMedia({
        video: {
          facingMode,
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      })
      .then((mediaStream) => {
        activeStream = mediaStream;
        setStream(mediaStream);
        if (videoRef.current) {
          videoRef.current.srcObject = mediaStream;
        }
      })
      .catch((err) => {
        console.warn("Camera access error:", err);
        setError(
          "No se pudo acceder a la cámara en directo. Usa el botón 'Abrir Selector de Cámara / Fotos del Dispositivo' abajo."
        );
      });

    return () => {
      if (activeStream) {
        activeStream.getTracks().forEach((t) => t.stop());
      }
    };
  }, [isOpen, facingMode]);

  if (!isOpen) return null;

  const handleTakeSnap = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        const file = new File([blob], `foto_ejercicios_${Date.now()}.jpg`, {
          type: "image/jpeg",
        });
        onCaptureFile(file);
        onClose();
      },
      "image/jpeg",
      0.92
    );
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/75 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white border border-slate-200 rounded-2xl max-w-xl w-full overflow-hidden shadow-xl">
        <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h3 className="font-display text-base font-bold text-slate-900">
              Hacer Foto al Ejercicio — ritaGPT
            </h3>
            <p className="text-xs text-slate-500">
              Enfoca tu hoja de ejercicios para convertirla y resolverla a mano
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-800 rounded-lg cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {error ? (
            <div className="p-6 bg-slate-50 border border-slate-200 rounded-xl text-center text-xs text-slate-600">
              {error}
            </div>
          ) : (
            <div className="relative bg-slate-950 rounded-xl overflow-hidden aspect-4/3 flex items-center justify-center">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="w-full h-full object-cover"
              />
              <button
                type="button"
                onClick={() =>
                  setFacingMode((m) => (m === "environment" ? "user" : "environment"))
                }
                className="absolute top-3 right-3 px-2.5 py-1.5 bg-black/60 hover:bg-black/80 text-white text-xs rounded-lg flex items-center gap-1.5 cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Girar Cámara</span>
              </button>
            </div>
          )}

          <div className="flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium text-slate-600 hover:text-slate-900 cursor-pointer"
            >
              Cancelar
            </button>
            {!error && (
              <button
                type="button"
                onClick={handleTakeSnap}
                className="px-5 py-2.5 bg-blue-700 hover:bg-blue-800 text-white text-xs font-semibold rounded-lg flex items-center gap-2 cursor-pointer"
              >
                <Camera className="w-4 h-4" />
                <span>Capturar Foto y Resolver</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
