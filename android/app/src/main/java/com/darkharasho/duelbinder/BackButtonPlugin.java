package com.darkharasho.duelbinder;

import androidx.activity.OnBackPressedCallback;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Android's back button and back gesture for src/phone/backButton.ts: every back is sent to the page
 * as a `back` event, and the page closes what's open. `exit()` is the page saying nothing was open:
 * back then does what it does in any app with nothing to go back to.
 */
@CapacitorPlugin(name = "BackButton")
public class BackButtonPlugin extends Plugin {

    private OnBackPressedCallback callback;

    @Override
    public void load() {
        callback = new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                notifyListeners("back", new JSObject());
            }
        };
        getActivity().getOnBackPressedDispatcher().addCallback(getActivity(), callback);
    }

    @PluginMethod
    public void exit(PluginCall call) {
        getActivity()
            .runOnUiThread(() -> {
                // Let the system's own back run once, without us in the way.
                callback.setEnabled(false);
                getActivity().getOnBackPressedDispatcher().onBackPressed();
                callback.setEnabled(true);
                call.resolve();
            });
    }
}
