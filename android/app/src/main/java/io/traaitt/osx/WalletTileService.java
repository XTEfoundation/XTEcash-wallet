// Copyright (c) 2026, TRRXITTE Int., incorporate. Licensed under AGPL-3.0.
package io.traaitt.osx;

import android.annotation.SuppressLint;
import android.app.PendingIntent;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.graphics.drawable.Icon;
import android.os.Build;
import android.service.quicksettings.Tile;
import android.service.quicksettings.TileService;

import androidx.annotation.RequiresApi;

/**
 * Quick Settings tile: shows the cached balance (hidden while the phone is locked) and
 * opens the receive screen. Long-press opens the app (system behaviour).
 */
@RequiresApi(24)
public class WalletTileService extends TileService {
    public static void requestUpdate(Context c) {
        if (Build.VERSION.SDK_INT >= 24) {
            try {
                TileService.requestListeningState(c, new ComponentName(c, WalletTileService.class));
            } catch (Throwable ignored) {
            }
        }
    }

    @Override
    public void onStartListening() {
        Tile tile = getQsTile();
        if (tile == null) return;
        WalletWidgetData d = WalletWidgetData.load(this);
        String ticker = getString(R.string.wallet_ticker);
        tile.setIcon(Icon.createWithResource(this, R.drawable.ic_shortcut_receive));
        tile.setLabel(getString(R.string.tile_label, ticker));
        tile.setState(d.hasWallet() ? Tile.STATE_ACTIVE : Tile.STATE_INACTIVE);
        if (Build.VERSION.SDK_INT >= 29) {
            String sub;
            if (!d.hasWallet()) sub = getString(R.string.widget_no_wallet);
            else if (isLocked() || d.hideBalance) sub = getString(R.string.tile_receive);
            else sub = d.balanceText;
            tile.setSubtitle(sub);
        }
        tile.updateTile();
    }

    @SuppressLint("StartActivityAndCollapseDeprecated")
    @Override
    public void onClick() {
        Intent i = new Intent(Intent.ACTION_VIEW, WalletWidgetData.route(this, "receive"), this, MainActivity.class);
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        Runnable open = () -> {
            if (Build.VERSION.SDK_INT >= 34) {
                startActivityAndCollapse(PendingIntent.getActivity(this, 300, i,
                    PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT));
            } else {
                startActivityAndCollapse(i);
            }
        };
        if (isLocked()) unlockAndRun(open); else open.run();
    }
}
