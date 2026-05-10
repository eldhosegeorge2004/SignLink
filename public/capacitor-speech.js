// Wrapper for Capacitor Native Speech Recognition Plugin
// Provides speech-to-text functionality for Android/iOS native platforms
(function (global) {
    const capacitor = global.Capacitor;
    // Check if running on native platform (Android/iOS) vs web
    const isNativePlatform = Boolean(
        capacitor &&
        typeof capacitor.isNativePlatform === 'function' &&
        capacitor.isNativePlatform()
    );
    // Register the native plugin if available
    const nativePlugin = isNativePlatform && typeof capacitor.registerPlugin === 'function'
        ? capacitor.registerPlugin('NativeSpeechRecognition')
        : null;

    // Check if speech recognition is available on the device
    async function isAvailable() {
        if (!nativePlugin) return false;

        try {
            const result = await nativePlugin.isAvailable();
            return Boolean(result && result.available);
        } catch (error) {
            console.warn('Native speech recognition availability check failed:', error);
            return false;
        }
    }

    // Get diagnostic information about available speech recognition services
    async function getDiagnostics() {
        if (!nativePlugin) {
            return {
                available: false,
                reason: 'native-plugin-missing',
                serviceCount: 0,
                services: []
            };
        }

        try {
            return await nativePlugin.getDiagnostics();
        } catch (error) {
            console.warn('Native speech recognition diagnostics failed:', error);
            return {
                available: false,
                reason: 'diagnostics-failed',
                serviceCount: 0,
                services: []
            };
        }
    }

    // Create a speech recognition session with event listeners
    // Returns an object with start(), stop(), and destroy() methods
    async function createSession(options = {}) {
        if (!nativePlugin) {
            throw new Error('Native speech recognition is not available on this platform.');
        }

        const listeners = [];
        // Helper to bind event listeners to the native plugin
        const bindListener = async (eventName, handler) => {
            if (typeof handler !== 'function') return;
            const listener = await nativePlugin.addListener(eventName, handler);
            listeners.push(listener);
        };

        // Bind all available event listeners from options
        await bindListener('start', (data) => options.onStart && options.onStart(data));
        await bindListener('partialResult', (data) => options.onPartial && options.onPartial(data));
        await bindListener('finalResult', (data) => options.onFinal && options.onFinal(data));
        await bindListener('error', (data) => options.onError && options.onError(data));
        await bindListener('end', (data) => options.onEnd && options.onEnd(data));

        // Return session control methods
        return {
            // Start speech recognition with optional language override
            async start(startOptions = {}) {
                return nativePlugin.start({
                    lang: startOptions.lang || options.lang || 'en-US',
                    partialResults: startOptions.partialResults ?? options.partialResults ?? true
                });
            },
            // Stop speech recognition
            async stop() {
                return nativePlugin.stop();
            },
            // Clean up all event listeners
            async destroy() {
                await Promise.all(listeners.map(async (listener) => {
                    if (listener && typeof listener.remove === 'function') {
                        await listener.remove();
                    }
                }));
            }
        };
    }

    // Export the API to global window object
    global.SignLinkCapacitorSpeech = {
        // Check if the plugin is supported on this platform
        isSupportedCandidate() {
            return Boolean(nativePlugin);
        },
        isAvailable,
        getDiagnostics,
        createSession
    };
})(window);
