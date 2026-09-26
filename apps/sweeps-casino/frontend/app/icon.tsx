import { ImageResponse } from "next/og";

// Dynamic favicon/app icon (Next.js App Router convention — no static
// image asset needed). Kept intentionally simple: ImageResponse renders a
// constrained subset of CSS, so this mirrors VaultlineLogo.tsx's palette
// and "V" mark rather than its full SVG gradient/arc geometry.
export const size = { width: 64, height: 64 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(135deg, #2a2e37 0%, #0a0b0d 100%)",
          borderRadius: 16,
        }}
      >
        <div
          style={{
            display: "flex",
            fontSize: 34,
            fontWeight: 900,
            color: "#2dc9b8",
            fontFamily: "sans-serif",
          }}
        >
          V
        </div>
      </div>
    ),
    { ...size }
  );
}
