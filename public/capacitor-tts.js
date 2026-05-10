// Capacitor Text-to-Speech Plugin
// Provides text-to-speech functionality for the application
var capacitorTextToSpeech = (function (exports, core) {
    'use strict';

    // Queue strategy enum for controlling speech playback behavior
    exports.QueueStrategy = void 0;
    (function (QueueStrategy) {
        /**
         * Use `Flush` to stop the current request when a new request is sent.
         */
        QueueStrategy[QueueStrategy["Flush"] = 0] = "Flush";
        /**
         * Use `Add` to buffer the speech request. The request will be executed when all previous requests have been completed.
         */
        QueueStrategy[QueueStrategy["Add"] = 1] = "Add";
    })(exports.QueueStrategy || (exports.QueueStrategy = {}));

    // Register the TextToSpeech plugin with Capacitor
    const TextToSpeech = core.registerPlugin('TextToSpeech', {
        web: () => Promise.resolve().then(function () { return web; }).then((m) => new m.TextToSpeechWeb()),
    });

    // Web implementation of Text-to-Speech using the Web Speech API
    class TextToSpeechWeb extends core.WebPlugin {
        constructor() {
            super();
            this.speechSynthesis = null;
            // Check if browser supports speech synthesis
            if ('speechSynthesis' in window) {
                this.speechSynthesis = window.speechSynthesis;
                // Stop speech when page unloads to prevent audio from continuing
                window.addEventListener('beforeunload', () => {
                    this.stop();
                });
            }
        }
        // Speak the given text with optional voice settings
        async speak(options) {
            if (!this.speechSynthesis) {
                this.throwUnsupportedError();
            }
            // Stop any current speech before starting new speech
            await this.stop();
            const speechSynthesis = this.speechSynthesis;
            const utterance = this.createSpeechSynthesisUtterance(options);
            return new Promise((resolve, reject) => {
                utterance.onend = () => {
                    resolve();
                };
                utterance.onerror = (event) => {
                    reject(event);
                };
                speechSynthesis.speak(utterance);
            });
        }
        // Stop all current speech
        async stop() {
            if (!this.speechSynthesis) {
                this.throwUnsupportedError();
            }
            this.speechSynthesis.cancel();
        }
        // Get list of supported languages from available voices
        async getSupportedLanguages() {
            const voices = this.getSpeechSynthesisVoices();
            const languages = voices.map((voice) => voice.lang);
            // Remove duplicate languages
            const filteredLanguages = languages.filter((v, i, a) => a.indexOf(v) == i);
            return { languages: filteredLanguages };
        }
        // Get list of all available voices
        async getSupportedVoices() {
            const voices = this.getSpeechSynthesisVoices();
            return { voices };
        }
        // Check if a specific language is supported
        async isLanguageSupported(options) {
            const result = await this.getSupportedLanguages();
            const isLanguageSupported = result.languages.includes(options.lang);
            return { supported: isLanguageSupported };
        }
        // Open voice installation settings (not implemented on web)
        async openInstall() {
            this.throwUnimplementedError();
        }
        // Create and configure a SpeechSynthesisUtterance with given options
        createSpeechSynthesisUtterance(options) {
            const voices = this.getSpeechSynthesisVoices();
            const utterance = new SpeechSynthesisUtterance();
            const { text, lang, rate, pitch, volume, voice } = options;
            if (voice) {
                utterance.voice = voices[voice];
            }
            // Volume must be between 0 and 1
            if (volume) {
                utterance.volume = volume >= 0 && volume <= 1 ? volume : 1;
            }
            // Rate must be between 0.1 and 10
            if (rate) {
                utterance.rate = rate >= 0.1 && rate <= 10 ? rate : 1;
            }
            // Pitch must be between 0 and 2
            if (pitch) {
                utterance.pitch = pitch >= 0 && pitch <= 2 ? pitch : 2;
            }
            if (lang) {
                utterance.lang = lang;
            }
            utterance.text = text;
            return utterance;
        }
        // Get available voices, caching them for performance
        getSpeechSynthesisVoices() {
            if (!this.speechSynthesis) {
                this.throwUnsupportedError();
            }
            // Cache voices to avoid repeated expensive calls
            if (!this.supportedVoices || this.supportedVoices.length < 1) {
                this.supportedVoices = this.speechSynthesis.getVoices();
            }
            return this.supportedVoices;
        }
        // Throw error if speech synthesis is not supported
        throwUnsupportedError() {
            throw this.unavailable('SpeechSynthesis API not available in this browser.');
        }
        // Throw error for features not implemented on web platform
        throwUnimplementedError() {
            throw this.unimplemented('Not implemented on web.');
        }
    }

    // Export the web implementation
    var web = /*#__PURE__*/Object.freeze({
        __proto__: null,
        TextToSpeechWeb: TextToSpeechWeb
    });

    exports.TextToSpeech = TextToSpeech;

    return exports;

})({}, capacitorExports);
//# sourceMappingURL=plugin.js.map
