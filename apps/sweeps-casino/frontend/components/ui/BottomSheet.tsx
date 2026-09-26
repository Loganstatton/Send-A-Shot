"use client";

// Bottom sheet primitive (Casino Visual Redesign — Phase C): anchored to
// the bottom of the viewport on mobile with a slide-up transition, rounded
// top corners, and a drag handle the user can pull down to dismiss; on
// desktop (sm+) it collapses into a centered modal, mirroring Modal.tsx's
// pattern. Used to move Provably Fair verification out of the main
// gameplay flow without losing any of its functionality.
import { ReactNode, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "@/components/ui/icons";
import { cn } from "@/lib/utils";

interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
}

const DISMISS_THRESHOLD_PX = 90;

export function BottomSheet({ open, onClose, title, children }: BottomSheetProps) {
  const [dragY, setDragY] = useState(0);
  const [dragging, setDragging] = useState(false);
  const dragStartY = useRef(0);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  useEffect(() => {
    if (!open) {
      setDragY(0);
      setDragging(false);
    }
  }, [open]);

  if (!open || typeof document === "undefined") return null;

  function onHandlePointerDown(e: React.PointerEvent) {
    dragStartY.current = e.clientY;
    setDragging(true);
    (e.target as Element).setPointerCapture?.(e.pointerId);
  }
  function onHandlePointerMove(e: React.PointerEvent) {
    if (!dragging) return;
    setDragY(Math.max(0, e.clientY - dragStartY.current));
  }
  function onHandlePointerUp() {
    if (!dragging) return;
    setDragging(false);
    if (dragY > DISMISS_THRESHOLD_PX) {
      onClose();
    } else {
      setDragY(0);
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center animate-fade-in sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div
        style={{
          transform: `translateY(${dragY}px)`,
          transition: dragging ? "none" : "transform 220ms cubic-bezier(0.16,1,0.3,1)",
        }}
        className={cn(
          "relative z-10 max-h-[85vh] w-full overflow-y-auto rounded-t-2xl border border-border bg-surface shadow-2xl animate-slide-up",
          "sm:max-w-md sm:max-h-[75vh] sm:rounded-2xl"
        )}
      >
        <div
          onPointerDown={onHandlePointerDown}
          onPointerMove={onHandlePointerMove}
          onPointerUp={onHandlePointerUp}
          onPointerCancel={onHandlePointerUp}
          className="flex cursor-grab touch-none justify-center py-2.5 active:cursor-grabbing sm:hidden"
        >
          <span className="h-1.5 w-10 rounded-full bg-border" />
        </div>

        {title && (
          <div className="flex items-center justify-between border-b border-border px-5 py-4">
            <h2 className="text-sm font-semibold text-text-primary">{title}</h2>
            <button
              onClick={onClose}
              aria-label="Close"
              className="rounded-md p-1 text-text-muted hover:bg-surface-raised hover:text-text-primary"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        <div className="p-5 pt-3 sm:pt-5">{children}</div>
      </div>
    </div>,
    document.body
  );
}
