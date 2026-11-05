package com.darkharasho.duelbinder;

import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.net.Uri;
import android.util.Base64;
import android.view.WindowManager;
import androidx.core.content.FileProvider;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;

/**
 * A stream (src/phone/stream/device.ts), matching ios/App/App/StreamPlugin.swift: the phone may
 * rotate to landscape and the screen stays on.
 * - `Stream.enter()`: follows the sensor in every orientation but upside down, and keeps the screen on.
 * - `Stream.exit()`: back to portrait only, and the screen may sleep again. The app calls it at start
 *   too, so a reloaded page starts upright.
 * - `Stream.shareFile({ name, mime, base64 })`: writes a file (a Rip Replay) to the cache and opens
 *   the share chooser.
 * The manifest's configChanges keep the activity (and the page) alive through a rotation.
 */
@CapacitorPlugin(name = "Stream")
public class StreamPlugin extends Plugin {

    @PluginMethod
    public void enter(PluginCall call) {
        getActivity()
            .runOnUiThread(() -> {
                getActivity().setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_USER);
                getActivity().getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                call.resolve();
            });
    }

    @PluginMethod
    public void exit(PluginCall call) {
        getActivity()
            .runOnUiThread(() -> {
                getActivity().setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_PORTRAIT);
                getActivity().getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                call.resolve();
            });
    }

    @PluginMethod
    public void shareFile(PluginCall call) {
        String name = call.getString("name");
        String mime = call.getString("mime", "application/octet-stream");
        String base64 = call.getString("base64");
        if (name == null || name.contains("/") || base64 == null) {
            call.reject("Not a file to share");
            return;
        }
        File file = new File(getContext().getCacheDir(), name);
        try (FileOutputStream out = new FileOutputStream(file)) {
            out.write(Base64.decode(base64, Base64.DEFAULT));
        } catch (IOException | IllegalArgumentException e) {
            call.reject("Couldn't write the file");
            return;
        }
        Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", file);
        Intent send = new Intent(Intent.ACTION_SEND);
        send.setType(mime);
        send.putExtra(Intent.EXTRA_STREAM, uri);
        send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        getActivity().runOnUiThread(() -> {
            getActivity().startActivity(Intent.createChooser(send, null));
            call.resolve();
        });
    }
}
