package com.signlink.app;

import android.Manifest;
import android.content.Intent;
import android.os.Bundle;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;

import androidx.annotation.Nullable;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.util.ArrayList;
import java.util.Locale;

@CapacitorPlugin(
    name = "NativeSpeechRecognition",
    permissions = {
        @Permission(alias = "microphone", strings = { Manifest.permission.RECORD_AUDIO })
    }
)
public class NativeSpeechRecognitionPlugin extends Plugin {

    private SpeechRecognizer speechRecognizer;
    private boolean isListening = false;
    private boolean stopRequested = false;
    private String pendingLanguage = "en-US";
    private boolean pendingPartialResults = true;

    @PluginMethod
    public void isAvailable(PluginCall call) {
        JSObject result = new JSObject();
        result.put("available", SpeechRecognizer.isRecognitionAvailable(getContext()));
        result.put("listening", isListening);
        call.resolve(result);
    }

    @PluginMethod
    public void start(PluginCall call) {
        if (!SpeechRecognizer.isRecognitionAvailable(getContext())) {
            call.reject("Native speech recognition is not available on this device.");
            return;
        }

        pendingLanguage = normalizeLanguage(call.getString("lang", "en-US"));
        pendingPartialResults = call.getBoolean("partialResults", true);

        if (getPermissionState("microphone") != PermissionState.GRANTED) {
            requestPermissionForAlias("microphone", call, "microphonePermissionCallback");
            return;
        }

        getBridge().executeOnMainThread(() -> startListening(call));
    }

    @PluginMethod
    public void stop(PluginCall call) {
        stopRequested = true;

        getBridge().executeOnMainThread(() -> {
            if (speechRecognizer == null) {
                isListening = false;
                call.resolve();
                return;
            }

            try {
                speechRecognizer.stopListening();
            } catch (Exception stopError) {
                try {
                    speechRecognizer.cancel();
                } catch (Exception cancelError) {
                    call.reject("Unable to stop speech recognition.", cancelError);
                    return;
                }
            }

            call.resolve();
        });
    }

    @PermissionCallback
    private void microphonePermissionCallback(PluginCall call) {
        if (getPermissionState("microphone") != PermissionState.GRANTED) {
            emitError("not-allowed", "Microphone permission denied.", false);
            call.reject("Microphone permission denied.");
            return;
        }

        getBridge().executeOnMainThread(() -> startListening(call));
    }

    @Override
    protected void handleOnDestroy() {
        super.handleOnDestroy();
        destroyRecognizer();
    }

    private void startListening(PluginCall call) {
        ensureSpeechRecognizer();

        try {
            stopRequested = false;
            if (isListening) {
                speechRecognizer.cancel();
            }
            isListening = false;
            speechRecognizer.startListening(buildRecognizerIntent(pendingLanguage, pendingPartialResults));
            call.resolve();
        } catch (Exception error) {
            isListening = false;
            emitError("start-failed", error.getMessage(), true);
            call.reject("Failed to start speech recognition.", error);
        }
    }

    private void ensureSpeechRecognizer() {
        if (speechRecognizer != null) return;

        speechRecognizer = SpeechRecognizer.createSpeechRecognizer(getContext());
        speechRecognizer.setRecognitionListener(new RecognitionListener() {
            @Override
            public void onReadyForSpeech(Bundle params) {
                isListening = true;
                JSObject data = new JSObject();
                data.put("listening", true);
                notifyListeners("start", data);
            }

            @Override
            public void onBeginningOfSpeech() {}

            @Override
            public void onRmsChanged(float rmsdB) {}

            @Override
            public void onBufferReceived(byte[] buffer) {}

            @Override
            public void onEndOfSpeech() {}

            @Override
            public void onError(int error) {
                isListening = false;

                String errorCode = mapErrorCode(error);
                boolean restartable = isRestartable(error);
                boolean wasStoppedDeliberately = stopRequested;
                stopRequested = false;

                if (!wasStoppedDeliberately) {
                    emitError(errorCode, mapErrorMessage(errorCode), restartable);
                }

                emitEnd(wasStoppedDeliberately ? "stopped" : "error", errorCode, restartable && !wasStoppedDeliberately);
            }

            @Override
            public void onResults(Bundle results) {
                isListening = false;
                stopRequested = false;
                emitTranscript("finalResult", results);
                emitEnd("results", null, true);
            }

            @Override
            public void onPartialResults(Bundle partialResults) {
                emitTranscript("partialResult", partialResults);
            }

            @Override
            public void onEvent(int eventType, Bundle params) {}
        });
    }

    private Intent buildRecognizerIntent(String languageTag, boolean partialResults) {
        Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, languageTag);
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, languageTag);
        intent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, partialResults);
        intent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 5);
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.M) {
            intent.putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, false);
        }
        return intent;
    }

    private void emitTranscript(String eventName, @Nullable Bundle results) {
        ArrayList<String> matches = results != null
            ? results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
            : null;

        if (matches == null || matches.isEmpty()) return;

        JSObject data = new JSObject();
        data.put("transcript", matches.get(0));

        JSArray jsMatches = new JSArray();
        for (String match : matches) {
            jsMatches.put(match);
        }
        data.put("matches", jsMatches);

        notifyListeners(eventName, data);
    }

    private void emitError(String errorCode, String message, boolean restartable) {
        JSObject data = new JSObject();
        data.put("error", errorCode);
        data.put("message", message);
        data.put("restartable", restartable);
        notifyListeners("error", data);
    }

    private void emitEnd(String reason, @Nullable String errorCode, boolean restartable) {
        JSObject data = new JSObject();
        data.put("listening", false);
        data.put("reason", reason);
        data.put("restartable", restartable);
        if (errorCode != null) {
            data.put("error", errorCode);
        }
        notifyListeners("end", data);
    }

    private String normalizeLanguage(String languageTag) {
        if (languageTag == null || languageTag.trim().isEmpty()) {
            return Locale.getDefault().toLanguageTag();
        }
        return languageTag;
    }

    private boolean isRestartable(int errorCode) {
        return errorCode != SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS
            && errorCode != SpeechRecognizer.ERROR_CLIENT;
    }

    private String mapErrorCode(int errorCode) {
        switch (errorCode) {
            case SpeechRecognizer.ERROR_AUDIO:
                return "audio-capture";
            case SpeechRecognizer.ERROR_NETWORK:
            case SpeechRecognizer.ERROR_NETWORK_TIMEOUT:
                return "network";
            case SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS:
                return "not-allowed";
            case SpeechRecognizer.ERROR_SERVER:
                return "service-not-allowed";
            case SpeechRecognizer.ERROR_CLIENT:
                return "aborted";
            case SpeechRecognizer.ERROR_NO_MATCH:
                return "no-match";
            case SpeechRecognizer.ERROR_SPEECH_TIMEOUT:
                return "no-speech";
            case SpeechRecognizer.ERROR_RECOGNIZER_BUSY:
                return "busy";
            default:
                return "unknown";
        }
    }

    private String mapErrorMessage(String errorCode) {
        switch (errorCode) {
            case "audio-capture":
                return "Unable to capture audio from the microphone.";
            case "network":
                return "Speech recognition network error.";
            case "not-allowed":
                return "Microphone permission denied.";
            case "service-not-allowed":
                return "Speech recognition service unavailable.";
            case "aborted":
                return "Speech recognition was interrupted.";
            case "no-match":
                return "No speech match was found.";
            case "no-speech":
                return "No speech was detected.";
            case "busy":
                return "Speech recognition is busy.";
            default:
                return "Speech recognition failed.";
        }
    }

    private void destroyRecognizer() {
        getBridge().executeOnMainThread(() -> {
            if (speechRecognizer == null) return;

            try {
                speechRecognizer.cancel();
                speechRecognizer.destroy();
            } catch (Exception ignored) {
                // Ignore cleanup failures during shutdown.
            }

            speechRecognizer = null;
            isListening = false;
            stopRequested = false;
        });
    }
}
