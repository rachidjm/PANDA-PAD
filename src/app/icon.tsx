import { ImageResponse } from "next/og";

export const size = { width: 32, height: 32 };
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
          background: "#0E0D0C",
          borderRadius: 7,
        }}
      >
        <svg width="26" height="26" viewBox="34 24 172 150">
          <circle cx="72" cy="54" r="26" fill="#0E0D0C" stroke="#F7F4EC" strokeWidth="6" />
          <circle cx="168" cy="54" r="26" fill="#0E0D0C" stroke="#F7F4EC" strokeWidth="6" />
          <path
            d="M120 40 C168 38 198 72 196 112 C194 156 164 190 120 190 C76 190 46 156 44 112 C42 72 72 38 120 40 Z"
            fill="#1C1A17"
            stroke="#F7F4EC"
            strokeWidth="6"
          />
          <circle cx="86" cy="110" r="13" fill="#F7F4EC" />
          <circle cx="154" cy="110" r="13" fill="#F7F4EC" />
          <circle cx="86" cy="110" r="6" fill="#1C1A17" />
          <circle cx="154" cy="110" r="6" fill="#1C1A17" />
        </svg>
      </div>
    ),
    size
  );
}
