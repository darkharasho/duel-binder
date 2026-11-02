package com.darkharasho.duelbinder;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // The app's own plugins (src/phone/nativeSignIn.ts, src/phone/stream/device.ts).
        registerPlugin(WebAuthPlugin.class);
        registerPlugin(StreamPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
