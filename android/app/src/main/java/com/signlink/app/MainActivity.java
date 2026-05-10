package com.signlink.app;

import android.os.Bundle;
import android.webkit.WebSettings;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(NativeSpeechRecognitionPlugin.class);
        super.onCreate(savedInstanceState);
        
        // Enable localStorage and other WebView features for training
        try {
            WebSettings webSettings = this.getBridge().getWebView().getSettings();
            webSettings.setDomStorageEnabled(true);
            webSettings.setDatabaseEnabled(true);
            webSettings.setCacheMode(WebSettings.LOAD_DEFAULT);
        } catch (Exception e) {
            // WebView might not be ready yet, that's okay
        }
    }
}
