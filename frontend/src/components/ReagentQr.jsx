import { useEffect, useRef } from 'react';
import QRCode from 'qrcode';
import { encodeLabel } from '@labhub/label-kit';
export default function ReagentQr({ id }) {
  const canvas = useRef(null);
  useEffect(() => {
    QRCode.toCanvas(canvas.current, encodeLabel({ type: 'reagent', id: String(id) }), { width: 180, margin: 2 });
  }, [id]);
  return <canvas ref={canvas} aria-label={`시약 식별 QR 코드 ${id}`} role="img" />;
}
