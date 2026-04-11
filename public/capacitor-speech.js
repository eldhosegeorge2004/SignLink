(function (global) {
    const capacitor = global.Capacitor;
    const isNativePlatform = Boolean(
        capacitor &&
        typeof capacitor.isNativePlatform === 'function' &&
        capacitor.isNativePlatform()
    );
    const nativePlugin = isNativePlatform && typeof capacitor.registerPlugin === 'function'
        ? capacitor.registerPlugin('NativeSpeechRecognition')
        : null;

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

    async function createSession(options = {}) {
        if (!nativePlugin) {
            throw new Error('Native speech recognition is not available on this platform.');
        }

        const listeners = [];
        const bindListener = async (eventName, handler) => {
            if (typeof handler !== 'function') return;
            const listener = await nativePlugin.addListener(eventName, handler);
            listeners.push(listener);
        };

        await bindListener('start', (data) => options.onStart && options.onStart(data));
        await bindListener('partialResult', (data) => options.onPartial && options.onPartial(data));
        await bindListener('finalResult', (data) => options.onFinal && options.onFinal(data));
        await bindListener('error', (data) => options.onError && options.onError(data));
        await bindListener('end', (data) => options.onEnd && options.onEnd(data));

        return {
            async start(startOptions = {}) {
                return nativePlugin.start({
                    lang: startOptions.lang || options.lang || 'en-US',
                    partialResults: startOptions.partialResults ?? options.partialResults ?? true
                });
            },
            async stop() {
                return nativePlugin.stop();
            },
            async destroy() {
                await Promise.all(listeners.map(async (listener) => {
                    if (listener && typeof listener.remove === 'function') {
                        await listener.remove();
                    }
                }));
            }
        };
    }

    global.SignLinkCapacitorSpeech = {
        isSupportedCandidate() {
            return Boolean(nativePlugin);
        },
        isAvailable,
        getDiagnostics,
        createSession
    };
})(window);
