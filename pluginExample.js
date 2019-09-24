var MySTTPlugin = (function(config) {
        var plugin = {
            button: config.mic,
            stopDelay: chat._sttDelay,
            recognition: undefined,
            registerChatPlugin: function (chat) {
                var me = this;

                chat.addEventListener('conversationStart', undefined, function () {
                    if (me.recognition === undefined) {
                        window.setTimeout(function () {
                            if (window.webkitSpeechRecognition === undefined) {
                                chat.sttMicFail(me.button, 'browser not supported');
                                return;
                            }

                            if (typeof me.button === 'string') {
                                me.button = document.getElementById(me.button);
                            }

                            if (me.button === undefined || me.button === null) {
                                chat.sttMicFail(me.button, 'button ' + me.button + ' does not exist');
                                return;
                            }

                            var abortSpeechRecognition = function (button) {
                                //check if is recording now
                                if (me.recognition._recording) {
                                    me.recognition.abort();
                                }
                            }

                            var stopSpeechRecognition = function (button) {
                                //check if is recording now
                                if (me.recognition._recording) {
                                    me.recognition.stop();
                                }
                            }

                            var initialSpeechRecognition = function (button) {

                                var recognition = new webkitSpeechRecognition();
                                recognition.continuous = true;
                                recognition.interimResults = true;
                                recognition._finalResults = [];
                                recognition._finalTimeStamp = undefined;
                                recognition._stillTalking = false;
                                chat.addEventListeners({
                                                           speakstart: function () {
                                                               abortSpeechRecognition();
                                                           },
                                                           speakend: function () {

                                                           }
                                                       });

                                recognition.onresult = function (event) {
                                    var interimResult = "";
                                    for (var i = event.resultIndex; i < event.results.length; ++i) {
                                        if (event.results[i].isFinal) {
                                            if (recognition._recording) {
                                                interimResult += event.results[i][0].transcript;
                                                recognition._finalResults.push(interimResult);
                                                recognition._finalTimeStamp = new Date().getTime();
                                                recognition._stillTalking = false;
                                            }
                                        } else {
                                            // Outputting the interim result to the text field and adding
                                            // an interim result marker - 0-length space
                                            //inputArea.setValue(event.results[i][0].transcript + '\u200B');
                                            if (recognition._recording) {
                                                interimResult += event.results[i][0].transcript + '\u200B';
                                                chat.sttMicTextInterim(me.button, event.results[i][0].transcript);
                                                recognition._stillTalking = true;
                                            }
                                        }
                                    }
                                    if (recognition._finalTimeStamp !== undefined) {
                                        window.setTimeout(function () {
                                            if (recognition._stillTalking === false) {
                                                recognition.stop();
                                            }
                                        }, me.stopDelay)
                                    }
                                }

                                //all the button status should be only changed in the start and end event handler
                                recognition.onend = function (event) {
                                    recognition._recording = false;
                                    if (recognition._finalResults.length > 0) {
                                        var finalText = '';
                                        for (var i = 0; i < recognition._finalResults.length; i++) {
                                            finalText += recognition._finalResults[i] + ' ';
                                        }
                                        chat.sttMicTextFinish(me.button, finalText);
                                        recognition._finalResults = [];
                                        recognition._finalTimeStamp = undefined;
                                    }
                                    chat.sttMicRecordingEnd(me.button);
                                }
                                recognition.onaudiostart = function (event) {
                                    recognition._recording = true;
                                    chat.sttMicRecordingStart(me.button);
                                }
                                recognition.onnomatch = function (event) {
                                    chat.sttMicNoMatch(me.button);
                                }
                                return recognition;
                            }

                            me.recognition = initialSpeechRecognition(me.button);

                            me.button.addEventListener('click', function () {
                                if (chat.getInputEnabled() !== true) {
                                    chat.fireEvent('ErrorInputBlocked', {},
                                                   chat.getConversationPartnerName(),
                                                   "Unable to dictate while input disabled");
                                    return;
                                }
                                //if is not recording then start
                                if (!me.recognition._recording) {
                                    if (me.recognition == null) {
                                        me.recognition = initialSpeechRecognition(me.button);
                                    }
                                    me.recognition.lang = chat.getLanguageCode();
                                    me.recognition.start();
                                } else {//if is recording then stop and don't return result
                                    stopSpeechRecognition(me.button);
                                    me.recognition._recording = false;
                                }
                            });
                            chat.sttMicReady(me.button);
                        }, 1000)
                    }
                });
            }
        }
        return plugin;
});

//a wrapper method interal to UI would prevent each plugin from having to do this, which is still not defensive enough, or spread notation
if (window.ameliaSdkPlugins) {
    window.ameliaSdkPlugins.push(new MySTTPlugin());
} else {
    window.ameliaSdkPlugins = [ new MySTTPlugin() ];
}