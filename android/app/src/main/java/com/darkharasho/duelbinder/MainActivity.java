package com.darkharasho.duelbinder;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // The app's own plugins (src/phone/nativeSignIn.ts, src/phone/stream/device.ts, src/phone/backButton.ts).
        registerPlugin(WebAuthPlugin.class);
        registerPlugin(StreamPlugin.class);
        registerPlugin(BackButtonPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
