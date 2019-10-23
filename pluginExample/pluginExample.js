/**
 * a mock version of the SDK, just enough to fire events that an STT plugin would need
 * @type {function(): {sttMicRecordingStart: sttMicRecordingStart, registerPlugin: registerPlugin,
 * sttMicNoMatch: sttMicNoMatch, listeners: {}, sttMicTextFinish: sttMicTextFinish, fireEvent: fireEvent,
 * sttMicTextInterim: sttMicTextInterim, _eventLock: {}, sttMicFail: sttMicFail, sttMicReady: sttMicReady,
 * sttMicRecordingEnd: sttMicRecordingEnd, addEventListener: addEventListener}}
 */
var MockSdk = (function() {

    var sdk = {

        registerPlugin: function(plugin) {
            if (plugin !== undefined && 'function' === typeof plugin.registerChatPlugin) {
                plugin.registerChatPlugin(sdk);
            }
        },

        /**
         * A hash of the listeners for events
         * @type {{}}
         * @private
         */
        listeners: {},

        /**
         * A mutex to make sure we do not call events circularly
         */
        _eventLock: {},


        /**
         * Add a listener to the chat
         * @param event {string} the name of the event to listen
         * @param recipient {sting} the object listening to the event, will be bound as "this" in the function
         * @param fn {function} the function to call when the event is received.  Arguments are:
         *    source - the ameliaChat instance that fired the event
         *    messageType - the name of the messageType fired
         *    msgBody - the body of the message
         *    headers - the headers of the message
         */
        addEventListener: function(event, recipient, fn) {
            if (this.listeners[event] === undefined) {
                this.listeners[event] = [];
            }
            this.listeners[event].push(fn.bind(recipient));
        },

        fireEvent: function(event) {
            if (this._eventLock[event] !== true) {
                this._eventLock[event] = true;
                if (this.listeners[event] !== undefined) {
                    var newArgs = [publicAmelia];
                    if (arguments.length > 1) {
                        for (var i = 1; i < arguments.length; i++) {
                            newArgs.push(arguments[i]);
                        }
                    }

                    for (var i = 0; i < this.listeners[event].length; i++) {
                        this.listeners[event][i].apply(undefined, newArgs);
                    }
                }
                console.error('fired Event ' + event + 'with arguments', arguments);
                this._eventLock[event] = false;
            } else {
                console.error("Circular event listening detected for event: " + event
                              +".  Listeners must not fire the same event to which they are listening.  Application will continue"
                              + " but this event chain will be stopped.");
            }
        },
        /**
         * Send the mictextready event, indicating that the stt engine has been initialized
         * @param arg {object} any object that should be passed as the second argument with the event.
         */
        sttMicReady: function(arg) {
            this.fireEvent('micready', arg);
        },

        /**
         * Send the micfail event, indicating that the stt engine cannot be initialized
         * @param arg {object} any object that should be passed as the second argument with the event.
         * @param msg {string} a message about the failure
         */
        sttMicFail : function(arg, msg) {
            this.fireEvent('micfail', arg, msg);
        },

        /**
         * Send the micrecordingstart event, indicating that the stt engine has begun recording sound
         * @param arg {object} any object that should be passed as the second argument with the event.
         */
        sttMicRecordingStart : function(arg) {
            this.fireEvent('micrecordingstart', arg);
        },

        /**
         * Send the mictextinterim event, indicating that the stt engine has returned a partial transcription, though has not yet completed recording
         * @param arg {object} any object that should be passed as the second argument with the event.
         * @param resultText {string} the transcribed text
         */
        sttMicTextInterim : function(arg, resultText) {
            this.fireEvent('mictextinterim', arg, resultText);
        },


        /**
         * Send the mictextinterim event, indicating that the stt engine has returned a partial transcription, though has not yet completed recording
         * @param arg {object} any object that should be passed as the second argument with the event.
         * @param resultText {string} the transcribed text
         */
        sttMicTextFinish : function(arg, resultText) {
            this.fireEvent('mictextfinish', arg, resultText);
        },

        /**
         * Send the micrecordingend event, indicating that the stt engine has finished recording sound
         * @param arg {object} any object that should be passed as the second argument with the event.
         */
        sttMicRecordingEnd : function(arg) {
            this.fireEvent('micrecordingend', arg);
        },

        /**
         * Send the micnomatch event, indicating that the stt engine was unable to come up with meanngful transcription
         * @param arg {object} any object that should be passed as the second argument with the event.
         */
        sttMicNoMatch : function(arg) {
            this.fireEvent('micnomatch', arg);
        }
    }
    return sdk;
});

/**
 * A naive plugin using HTML5 UserMedia directly.  Presented as is, as an example only.
 * @type {Function}
 * @param config a config option, with only only relevant key "recordingInterval", the interval in ms between submission attempts
 */
var MyUserMediaPlugin = (function(config) {

    config = config || {};
    config.recordingInterval = config.recordingInterval || 3000; // 3 seconds per attempt to submit
    const mic = {

        device: undefined,
        recording: false,

        //how often the media recorder will process chunks, in ms
        recordingInterval: config.recordingInterval,

        registerChatPlugin: function(chat) {
            this.sdk = chat;

            // Step 1, find the appropriate input device.  This naively grabs the first one
            // different browsers have diffrerent quirks
            // also, permissions check can prevent this from popping up access request
            // every time, but that is also browser quirks
            navigator.mediaDevices.enumerateDevices().then((devices) => {
                devices = devices.filter((d) => d.kind === 'audioinput');

                //if we do not find any, then fire micFail and stop.  We are done.
                if (devices.length === 0) {
                    console.error('fire sttMicFail as we have no audio devices');
                    this.sdk.sttMicFail(this);
                } else {
                    console.error('fire sttMicReady, as we have a device');
                    this.ready = true;
                    this.device = devices[0];
                    this.sdk.sttMicReady(this);
                }
            });

            //Step two, register listeners for Amelia starting and stopping talking, if requried
            this.sdk.addEventListener('speakstart', this, function(chat) {
                //cut or pause mic or whatever the STT engine requires if amelia talking over mic input is not desired
            })

            this.sdk.addEventListener('speakend', this, function(chat) {
                //restore or restart mic or whatever the STT engine requires
            })
        },

        // the internal method to post bytes to their engine
        _postToSttEngine(data) {
            // promise or events would come from whatever ajax library is in use here.  submits data, gets back text
            // Should be non-blocking to the UI
            return new Promise(function(resolve, reject) {
                console.error("this would be submitting to the service", data)
                resolve("My text result");
            });
        },

        //internal method to handle the posting of data
        _handleSuccess: function(stream) {
            console.error('fire sttMicRecordingStart, as we are now recording audio');
            this.recording = true;
            this.sdk.sttMicRecordingStart(this);
            // Chrome natively records webm;  If another format is desired, this must be transcoded client or server side
            // Other browsers may have other native formats
            const options = {mimeType: 'audio/webm'};

            // MediaRecorder is not supported in all browsers, but is sufficient for this skeleton example
            // https://caniuse.com/#search=MediaRecorder
            // a public stop() method, if desired, would need to be able to get at this as well
            const mediaRecorder = new MediaRecorder(stream, options);
            const recordedChunks = [];

            const me = this;
            let currentResult = undefined;
            // We get new bytes every interval.  These are the difficult questions that can only be answered in concert
            // with the STT engine design
            // 1) Do we submit every interval?  Do we need to submit streams over a socket instead of http post?
            // 2) How do we decide when we are "done"
            // 3) When and how do we turn back on again
            mediaRecorder.ondataavailable = (e)=> {
                if (e.data.size > 0) {
                    recordedChunks.push(e.data);
                    me._postToSttEngine(recordedChunks).then(function(result) {
                        //we have a result
                        if (result === undefined || result.length === 0) {
                            //we have no result.  possibly the engine cannot transcribe the audio?
                            mediaRecorder.stop();
                            return;
                        }

                        //have our transcription results changed in the last interval?  if so, consider the user done
                        if (result === currentResult) {
                            if (mediaRecorder.state !== 'inactive') {
                                console.error('our transcription is the same, stop the recorder so we can emit it as final');
                                mediaRecorder.stop();
                            }
                        } else {
                            //update our current result and fire that out to the SDK
                            currentResult = result;
                            console.error('we have a transcription different than previous one, emit it as interim');
                            me.sdk.sttMicTextInterim(me, result);
                        }
                    }).catch(function(error) {
                        console.error("we have an error, what to do and what event to fire depends on error", error);
                    })
                }
            };
            mediaRecorder.onstop = () => {
                if (this.recording == true) {
                    if (currentResult === undefined || currentResult.length === 0) {
                        console.error("sttMicNoMatch - engine cannot transcribe audio");
                        me.sdk.sttMicNoMatch(me);
                    } else {
                        console.error("sttMicTextFinish - we have our transcription");
                        me.sdk.sttMicTextFinish(me, currentResult);
                    }
                    me.recording = false;
                    stream.getTracks().forEach(track => track.stop())
                    //we have shut down mic
                    me.sdk.sttMicRecordingEnd(me);
                }
            };
            mediaRecorder.start(this.recordingInterval);
        },

        record: function() {
            //Get the mic
            if (this.sdk === undefined || this.device === undefined) {
                console.error('sttMicFail - mic not initialized');
                this.sdk.sttMicFail(this);
                return;
            }

            //getUserMedia has browser-specific quirks, see
            // https://caniuse.com/#feat=stream
            navigator.mediaDevices.getUserMedia({
                    audio: {
                        deviceId: this.device
                    },
                    video:false
                })
                .then(this._handleSuccess.bind(this));
        },

    }
    return mic;
});