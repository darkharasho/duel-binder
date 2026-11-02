package com.darkharasho.duelbinder;

import android.content.pm.ActivityInfo;
import android.view.WindowManager;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * A stream (src/phone/stream/device.ts), matching ios/App/App/StreamPlugin.swift: the phone may
 * rotate to landscape and the screen stays on.
 * - `Stream.enter()`: follows the sensor in every orientation but upside down, and keeps the screen on.
 * - `Stream.exit()`: back to portrait only, and the screen may sleep again. The app calls it at start
 *   too, so a reloaded page starts upright.
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
}
