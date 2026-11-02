package com.darkharasho.duelbinder;

import android.content.Intent;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import androidx.browser.customtabs.CustomTabsIntent;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * The Android side of src/phone/nativeSignIn.ts, matching ios/App/App/WebAuthPlugin.swift:
 * - `start({url, callbackScheme})` opens `url` in a Custom Tab and resolves `{url}` with the
 *   callback the sign-in ends at (duelbinder://auth/callback?…, which the manifest routes back to
 *   this activity). Closing the tab without finishing rejects with the code CANCELLED.
 * - `appleSignIn` doesn't exist on Android: it rejects with the code UNAVAILABLE.
 */
@CapacitorPlugin(name = "WebAuth")
public class WebAuthPlugin extends Plugin {

    /** How long a resume waits for the callback before it counts as a closed tab. */
    private static final long CANCEL_GRACE_MS = 600;

    private final Handler main = new Handler(Looper.getMainLooper());
    private PluginCall pending;
    private String pendingScheme;
    /** The activity went to the background after the tab opened. */
    private boolean leftForTab;

    @PluginMethod
    public void start(PluginCall call) {
        String url = call.getString("url");
        String scheme = call.getString("callbackScheme");
        if (url == null || scheme == null) {
            call.reject("url and callbackScheme are required");
            return;
        }
        // A second sign-in replaces the first, as on iOS.
        cancelPending();
        pending = call;
        pendingScheme = scheme;
        leftForTab = false;
        call.setKeepAlive(true);
        getActivity()
            .runOnUiThread(() -> {
                try {
                    new CustomTabsIntent.Builder().setShowTitle(true).build().launchUrl(getActivity(), Uri.parse(url));
                } catch (Exception e) {
                    finish(null, "Couldn't open the sign-in page", "FAILED");
                }
            });
    }

    @PluginMethod
    public void appleSignIn(PluginCall call) {
        call.reject("Sign in with Apple isn't available on Android", "UNAVAILABLE");
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        Uri uri = intent.getData();
        if (pending == null || uri == null || !pendingScheme.equals(uri.getScheme())) return;
        JSObject out = new JSObject();
        out.put("url", uri.toString());
        finish(out, null, null);
    }

    @Override
    protected void handleOnPause() {
        if (pending != null) leftForTab = true;
    }

    @Override
    protected void handleOnResume() {
        if (pending == null || !leftForTab) return;
        PluginCall waiting = pending;
        // The callback's new intent normally arrives before the resume; wait a moment in case it doesn't.
        main.postDelayed(() -> {
            if (pending == waiting) finish(null, "Sign-in was closed", "CANCELLED");
        }, CANCEL_GRACE_MS);
    }

    private void cancelPending() {
        if (pending != null) finish(null, "Sign-in was replaced", "CANCELLED");
    }

    /** Resolves with `result`, or rejects with `message` and `code`, and forgets the call. */
    private void finish(JSObject result, String message, String code) {
        PluginCall call = pending;
        pending = null;
        pendingScheme = null;
        leftForTab = false;
        if (call == null) return;
        if (result != null) call.resolve(result);
        else call.reject(message, code);
        call.setKeepAlive(false);
        getBridge().releaseCall(call);
    }
}
