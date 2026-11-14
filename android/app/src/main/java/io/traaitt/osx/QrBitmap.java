// Copyright (c) 2026, TRRXITTE Int., incorporate. Licensed under AGPL-3.0.
package io.traaitt.osx;

import android.graphics.Bitmap;
import android.graphics.Color;

import com.google.zxing.BarcodeFormat;
import com.google.zxing.EncodeHintType;
import com.google.zxing.common.BitMatrix;
import com.google.zxing.qrcode.QRCodeWriter;
import com.google.zxing.qrcode.decoder.ErrorCorrectionLevel;

import java.util.EnumMap;
import java.util.Map;

/** QR code bitmaps for the receive widget and notifications. */
public final class QrBitmap {
    private QrBitmap() {}

    public static Bitmap encode(String text, int size) {
        if (text == null || text.isEmpty()) return null;
        try {
            Map<EncodeHintType, Object> hints = new EnumMap<>(EncodeHintType.class);
            hints.put(EncodeHintType.ERROR_CORRECTION, ErrorCorrectionLevel.M);
            hints.put(EncodeHintType.MARGIN, 1);
            BitMatrix m = new QRCodeWriter().encode(text, BarcodeFormat.QR_CODE, size, size, hints);
            int w = m.getWidth(), h = m.getHeight();
            int[] px = new int[w * h];
            for (int y = 0; y < h; y++) {
                for (int x = 0; x < w; x++) {
                    px[y * w + x] = m.get(x, y) ? Color.BLACK : Color.WHITE;
                }
            }
            Bitmap b = Bitmap.createBitmap(w, h, Bitmap.Config.RGB_565);
            b.setPixels(px, 0, w, 0, 0, w, h);
            return b;
        } catch (Exception e) {
            return null;
        }
    }
}
