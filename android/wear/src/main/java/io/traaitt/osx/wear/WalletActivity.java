// Copyright (c) 2026, TRRXITTE Int., incorporate. Licensed under AGPL-3.0.
package io.traaitt.osx.wear;

import android.app.Activity;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.text.format.DateUtils;
import android.view.View;
import android.widget.ImageView;
import android.widget.TextView;

import com.google.android.gms.wearable.DataClient;
import com.google.android.gms.wearable.DataEvent;
import com.google.android.gms.wearable.DataEventBuffer;
import com.google.android.gms.wearable.DataItem;
import com.google.android.gms.wearable.DataMap;
import com.google.android.gms.wearable.DataMapItem;
import com.google.android.gms.wearable.Wearable;
import com.google.zxing.BarcodeFormat;
import com.google.zxing.EncodeHintType;
import com.google.zxing.common.BitMatrix;
import com.google.zxing.qrcode.QRCodeWriter;

import java.util.EnumMap;
import java.util.Map;

/**
 * Balance, last payment and the receive QR code, sent by the phone (WearBridge). Tap the
 * screen to switch between balance and QR. The watch never has any key.
 */
public class WalletActivity extends Activity implements DataClient.OnDataChangedListener {
    private static final String PATH = "/wallet/snapshot";
    private TextView title, balance, last, status;
    private ImageView qr;
    private View balancePane;
    private DataMap snapshot;

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        setContentView(R.layout.activity_wallet);
        title = findViewById(R.id.title);
        balance = findViewById(R.id.balance);
        last = findViewById(R.id.last);
        status = findViewById(R.id.status);
        qr = findViewById(R.id.qr);
        balancePane = findViewById(R.id.balance_pane);
        findViewById(R.id.root).setOnClickListener(v -> toggle());
        render();
    }

    private void toggle() {
        boolean showQr = qr.getVisibility() != View.VISIBLE;
        qr.setVisibility(showQr ? View.VISIBLE : View.GONE);
        balancePane.setVisibility(showQr ? View.GONE : View.VISIBLE);
    }

    @Override
    protected void onResume() {
        super.onResume();
        Wearable.getDataClient(this).addListener(this);
        Wearable.getDataClient(this).getDataItems(new Uri.Builder().scheme("wear").path(PATH).build())
            .addOnSuccessListener(items -> {
                for (DataItem item : items) {
                    snapshot = DataMapItem.fromDataItem(item).getDataMap();
                }
                items.release();
                render();
            });
    }

    @Override
    protected void onPause() {
        super.onPause();
        Wearable.getDataClient(this).removeListener(this);
    }

    @Override
    public void onDataChanged(DataEventBuffer events) {
        for (DataEvent e : events) {
            if (e.getType() == DataEvent.TYPE_CHANGED && PATH.equals(e.getDataItem().getUri().getPath())) {
                snapshot = DataMapItem.fromDataItem(e.getDataItem()).getDataMap();
            }
        }
        runOnUiThread(this::render);
    }

    private void render() {
        if (snapshot == null || snapshot.getString("address", "").isEmpty()) {
            title.setText(R.string.app_name);
            balance.setText("—");
            last.setText(R.string.open_phone);
            status.setText("");
            qr.setImageDrawable(null);
            return;
        }
        String ticker = snapshot.getString("ticker", "");
        title.setText(getString(R.string.wallet_title, ticker));
        String bal = snapshot.getString("balanceText", "");
        balance.setText(bal.isEmpty() ? "•••" : bal);
        String lp = snapshot.getString("lastPaymentText", "");
        last.setText(lp.isEmpty() ? "" : lp + " · " + DateUtils.getRelativeTimeSpanString(snapshot.getLong("lastPaymentTime", 0)));
        long updated = snapshot.getLong("updatedAt", 0);
        status.setText(snapshot.getBoolean("synced", false)
            ? getString(R.string.updated, DateUtils.getRelativeTimeSpanString(updated))
            : getString(R.string.syncing));
        qr.setImageBitmap(encode(snapshot.getString("address", ""), 300));
    }

    private static Bitmap encode(String text, int size) {
        try {
            Map<EncodeHintType, Object> hints = new EnumMap<>(EncodeHintType.class);
            hints.put(EncodeHintType.MARGIN, 1);
            BitMatrix m = new QRCodeWriter().encode(text, BarcodeFormat.QR_CODE, size, size, hints);
            int w = m.getWidth(), h = m.getHeight();
            int[] px = new int[w * h];
            for (int y = 0; y < h; y++) for (int x = 0; x < w; x++) px[y * w + x] = m.get(x, y) ? Color.BLACK : Color.WHITE;
            Bitmap bmp = Bitmap.createBitmap(w, h, Bitmap.Config.RGB_565);
            bmp.setPixels(px, 0, w, 0, 0, w, h);
            return bmp;
        } catch (Exception e) {
            return null;
        }
    }
}
