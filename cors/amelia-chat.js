/**
 * Amelia chat module for Amelia V3
 * Version: 3.7-SNAPSHOT
 * @type {Function}
 * @returns an instance of an Amelia Chat, with public methods and events
 * @todo document methods and events correctly
 */

const ngrokHost = "https://14b9-70-95-144-82.ngrok-free.app";

var AmeliaChat = (function(config) {
	var chat = this;
	config = config || {};

    chat._initialConfig = config;

	//the object to be returned outside this closure, established here to exist in listeners created during construction
	var publicAmelia = { };

	//the messageTypes that can dictate the response be secure or insecure
	chat._secureAbleMessageTypes = ['OutboundTextMessage', 'OutboundFormInputMessage', 'OutboundEchoMessage'];
	chat._allowIntentDetectionInFormInputTypes = ['OutboundFormInputMessage'];
	chat._offTheRecordAbleMessageTypes = ['clientpreference', 'OutboundTextMessage', 'OutboundFormInputMessage', 'OutboundEchoMessage'];

	chat._isV4 = true; //assume V4 unless we have a V3 return in init
	// chat-wide internal properties
	chat._multipleConversationMode = config.multipleConversationMode || false;
	chat._wsConnection = undefined;
	chat._conversationsBySessionId = {};
	chat._is37OrHigher = false;
	chat._domainCode = config.domainCode || 'global'; //default to global for demos
	chat._canJoinDefaultDomain = config.canJoinDefaultDomain === true || false;
	chat._includeHiddenDomains = config.includeHiddenDomains === true || false;
	chat.channels = config.channels || {
		'USER': "webchat_coreuser",
		'AGENT': 'js_sdk',
		'OBSERVER' : 'js_sdk'
	}
	chat._languageCode = config.languageCode || 'en-US';
	chat._conversationId= config.conversationId || null;
	chat._userInterface = /*config.userInterface ||*/ 'WEB_USER';
	chat._allowAnonymous = config.allowAnonymous || true;
	chat._customUpload = config.customUpload === true || false;

	//to keep track of what conversation is in the foreground
	chat._foreGroundSessionId = null;
	//rejoining is only for initial page load.  it is reset afterwards
	chat._rejoin = config.rejoin || false;

	chat._accept = config.accept || {
		push: false,
		escalation: false
	}

	//normalize in case somebody enters a hash without required values
	chat._accept.push = chat._accept.push || false;
	chat._accept.escalation = chat._accept.escalation || false;

	chat._sttDelay = config.sttDelay || 1500;
	if (chat._sttDelay < 0) {
		chat._sttDelay = 1500;
	}

	chat._subscriptionConfig = config.subscription || {};

	/**
	 * Dependency-free way to get a XmlHttpRequest object
	 * @private
	 * @returns an instance of XmlHttpRequest suitable for the browser used
	 */
	var getXhr=function() {
		var xhr;
		try {
			xhr = new XMLHttpRequest();
		} catch (err) {
			xhr = new ActiveXObject("MSXML2.XMLHTTP.3.0");
		}
		xhr.withCredentials = true;
		return xhr;
	};

	/**
	 * A convenience function to add items to a hash if not already present, since we dont have spread syntax yet
	 *
	 * @param dest {object} the hash to modify
	 * @param source {object} the hash with elements to insert into the dest, if the dest does not have them
	 */
	var applyIf = function(dest, source) {
		for (var key in source) {
			if (source.hasOwnProperty(key) && !dest.hasOwnProperty(key) || dest[key] === undefined || dest[key] === null) {
				dest[key]=source[key]
			}
		}
	}

	/**
	 * Compare browser versions, returning true if v1 is equal to or later than v2.
	 * @param v1 browser version 1
	 * @param v2 browser version 2
	 * @returns true if v1 >= v2, false otherwise
	 */
	var versionCompare = function(v1, v2) {
		var vnum1 = 0, vnum2 = 0;

		for (var i = 0, j = 0; (i < v1.length
			|| j < v2.length);) {

			while (i < v1.length && v1[i] != '.') {
				vnum1 = vnum1 * 10 + (v1[i] - '0');
				i++;
			}
			while (j < v2.length && v2[j] != '.') {
				vnum2 = vnum2 * 10 + (v2[j] - '0');
				j++;
			}

			if (vnum1 > vnum2)
				return true;
			if (vnum2 > vnum1)
				return false;

			vnum1 = vnum2 = 0;
			i++;
			j++;
		}
		return true;
	}

	/**
	 * Dependency-free way to get Json
	 * @private
	 * @param {string} url the url to get
	 * @param headers {object} a hash of headers to add to the request
	 * @param before {function} a callback to execute before the request
     * @param afteropen {function} a callback to execute after the request is opened
	 * @param success {function} a callback to execute upon a successful request
	 * @param failure {function} a callback to execute upon a request failure
	 */
	var getJson=function(url, headers, before, afteropen, success, failure) {
		var xhr = getXhr();
		url = ngrokHost + url;
		
		if (typeof before === 'function') {
			before.call(chat, xhr);
		}
		xhr.open('GET', url);
		
        if (typeof afteropen === 'function') {
            afteropen.call(chat, xhr);
        }
		if (headers !== undefined) {
			for (var key in headers) {
				if (headers.hasOwnProperty(key)) {
					xhr.setRequestHeader(key, headers[key]);
				}
			}
		}
		xhr.setRequestHeader('Accept', 'application/json,text/xml,text/html,text/plain');
		xhr.setRequestHeader("X-PINGOTHER", "pingpong");
		var failure = failure || function(xhr) {
				//console.error('Request failed.  Returned status of ' + xhr.status);
				//console.error(xhr);
			}.bind(chat);

		xhr.onload = function() {
			if (xhr.readyState === 4) {
				if (xhr.status === 200) {
					if (typeof success === 'function') {
						success.call(chat, xhr);
					}
				} else {
					if (typeof failure === 'function') {
						failure.call(chat, xhr);
					}
				}
			}
		};
		xhr.send();
	};

	/**
	 * Dependency-free way to get Json
	 * @private
	 * @param {string} url the url to get
	 * @param headers {object} a hash of headers to add to the request
	 * @param params {object} a hash of parameters to apply to the bpst.  Ignored if body is present
	 * @param body {object} UNIMPLEMENTED the body of a post reqeust
	 * @param before {function} a callback to execute before the request
     * @param afteropen {function} a callback to execute after the request is opened
	 * @param success {function} a callback to execute upon a successful request
	 * @param failure {function} a callback to execute upon a request failure
	 * 	* @todo unify get and post to eliminate duplicate code
	 */
	var postJson=function(url, headers, params, body, before, afteropen, success, failure) {
		var xhr = getXhr();
		url = ngrokHost + url;
		if (typeof before === 'function') {
			before.call(chat, xhr);
		}
		xhr.open('POST', url);
        if (typeof afteropen === 'function') {
            afteropen.call(chat, xhr);
        }
		if (headers !== undefined) {
			for (var key in headers) {
				//do not set multipart/form-data, as the browser needs to reconcile boundaries
				if (key !== 'Content-type' || headers[key] !== 'multipart/form-data') {
					xhr.setRequestHeader(key, headers[key]);
				}
			}
		}
		var toSend;
		if (body !== undefined) {
			toSend = body;
		} else {
			if (headers['Content-type'] === 'multipart/form-data') {
				toSend = new FormData();
				for (var key in params) {
					if (params.hasOwnProperty(key)) {
						toSend.append(key, params[key]);
					}
				}
			} else {
				xhr.setRequestHeader('Content-type', 'application/x-www-form-urlencoded');
				toSend = '';
				for (var key in params) {
					if (params.hasOwnProperty(key)) {
						toSend += key + '=' + encodeURIComponent(params[key]) + '&';
					}
				}
			}
		}
        xhr.setRequestHeader('Accept', 'application/json,text/xml,text/html,text/plain');
		var failure = failure || function(xhr) {
			}.bind(chat);

		xhr.onload = function() {
			if (xhr.readyState === 4) {
				if (xhr.status === 200) {
					if (typeof success === 'function') {
						success.call(chat, xhr);
					}
				} else {
					if (typeof failure === 'function') {
						failure.call(chat, xhr);
					}
				}
			}
		};
		xhr.send(toSend);
	};

    //is something an array?
    var isArray = function(a) {
        return a && a.constructor === Array;
    }

	/**
	 * A convenience function to add items to a hash if not already present
	 *
	 * @param dest {object} the hash to modify
	 * @param source {object} the hash with elements to insert into the dest, if the dest does not have them
	 */
	var applyIf = function(dest, source) {
		for (var key in source) {
			if (source.hasOwnProperty(key) && !dest.hasOwnProperty(key) || dest[key] === undefined || dest[key] === null) {
				dest[key]=source[key]
			}
		}
	}

    var queryStringToHash = function(s, keyFn) {
    	if (keyFn === undefined) {
    		keyFn = function(key) { return key;}
		}
        if (s.length > 0) {
            var params = {};
            var pvs = s.split('&');
            for (var i=0;i<pvs.length;i++) {
                var p = keyFn(pvs[i].substring(0, pvs[i].indexOf('=')));
                if (p !== false) {
                    var v = pvs[i].substring(pvs[i].indexOf('=') + 1);
                    var vs = undefined;
                    if (v !== undefined && v.length > 0) {
                        if (v.indexOf(',') > -1) {
                            vs = v.split(',');
                        } else {
                            v = decodeURIComponent(v);
                        }
                    }

                    if (vs === undefined) {
                        vs = [v];
                    }
                    for (var vi = 0; vi < vs.length; vi++) {
                        if (params[p] === undefined) {
                            params[p] = vs[vi];
                        } else if (isArray(params[p])) {
                            params[p].push(vs[vi]);
                        } else {
                            params[p] = [params[p], vs[vi]];
                        }
                    }
                }
            }
            return params;
        }
        return {};
	}

	chat.getSessionId = function() { return chat._foreGroundSessionId;}
	chat._setSessionId = function (sessionId) { chat._foreGroundSessionId = sessionId;}
	chat._ameliaSessionId = null;
	chat.getConversationId = function() {
		return chat._getForegroundConversation()._conversationId;
	}
	chat._setConversationId = function (conversationId) { chat._conversationId = conversationId;}
	chat.getContextId = function() { return chat._getForegroundConversation()._contextId;}
	chat._setContextId = function (contextId) { chat._contextId = contextId;}
	chat.getDomainCode = function() { return chat._domainCode;}
	chat.setDomainCode = function(domainCode) {
		//no validation of domaincodes, unlike V2
		chat._hasDomainBeenSet = true;//a flag to tell us we can bypass default domain selection
		chat._domainCode = domainCode;
	}
	chat._joinSubscription = undefined;
	chat._escalationSubscription = undefined;

	chat._setUser = function(user) {
		chat._user = user;

		chat._establishChatLevelByUser(user);
		if (chat._is37OrHigher === true) {
			if (chat._joinSubscription && chat._joinSubscription.unsubscribe) {
				chat._joinSubscription.unsubscribe();
			}
			if (chat._escalationSubscription && chat._escalationSubscription.unsubscribe) {
				chat._escalationSubscription.unsubscribe();
			}
			if (user !== undefined) {
				//check for anonymous?
				if (chat._accept.push === true) {
					chat._joinSubscription = new JoinConversationSubscription({
					  wsConnection: chat._wsConnection,
					  userId: user.userId,
					  messageHandler: function (message) {
						  var msgBody = JSON.parse(message.body);
						  msgBody.autoSwitch = true;
						  if (msgBody.autoSwitch === true) {
						  	chat.joinConversation(msgBody.conversationId, msgBody);
						  }
						  publicAmelia.fireEvent(msgBody.messageType,
												 msgBody.messageType,
												 msgBody, message.headers);
					  }
				  });
				  chat._joinSubscription.subscribe();
				}

				if (chat._accept.escalation === true && user.agent === true) {
					chat._escalationSubscription = new EscalationSubscription({
					  wsConnection: chat._wsConnection,
					  userId: user.userId
				  });
			      chat._escalationSubscription.subscribe();
				}
			}


		}
	}

	chat._sttDelay = config.sttDelay || 1500;
	if (chat._sttDelay < 0) {
        chat._sttDelay = 1500;
    }
    chat._subscriptionConfig = config.subscription || {};
    chat._messages = new Queue();

    var defaultInitAuthSystemFn = function() {
    	if (window.location.search !== undefined) {
			var params = queryStringToHash(window.location.search.substring(1));
			if (params && params.as) {
				return params.as;
			}
		}
    	return undefined;
    };

	if (config.authSystems === undefined ) {
		chat._authSystems=defaultInitAuthSystemFn;
	} else if (typeof config.authSystems === 'object') {
		chat._authSystems = function() { return config.authSystems.as;}
	} else if (typeof config.authSystems === 'string') {
		chat._authSystems = function() { return config.authSystems;}
	} else if (typeof config.authSystems === 'function') {
		chat._authSystems=config.authSystems;
	} else {
		chat._authSystems=defaultInitAuthSystemFn;
	}

	chat.initAuthSystems = function(success, failure) {

		var succ = function(xhr) {
			var data = [];
			try {
				data = JSON.parse(xhr.responseText);
				publicAmelia.fireEvent("authSystemsLoad", data);
			} catch (err) {
				publicAmelia.fireEvent("authSystemsLoad", []);
			}
			if (typeof success === 'function') {
				success.call(chat, data);
			}
		}

		var fail = function(xhr) {
			publicAmelia.fireEvent("authSystemsLoad", []);
			if (typeof failure === 'function') {
				failure.call(chat, []);
			}
		}
		var systems = chat._authSystems();
		var qs = '';
		if (systems !== undefined) {
			qs += '?as=';
			if (isArray(systems)) {
				for (var i=0;i<systems.length;i++) {
					qs += systems[i];
					if (i < systems.length-1) {
						qs+='&as=';
					}
				}
			} else {
				qs += systems;
			}
		}

		getJson('/Amelia/api/loginauthsystems'+qs, chat._sessionHeaders({}), undefined, function(xhr) {
		}, succ, fail);
	}

	/**
	 * A WebsocketConnection used for multiple Amelia Chats
	 * @type {function(*): *}
	 */
	var WebsocketConnection = (function(config) {
		var wsConnection = this;

		wsConnection.reconnectDelayMs = config.reconnectDelayMs || 2000;
		wsConnection.onHttpSessionInvalid = config.onHttpSessionInvalid;
		wsConnection.failedReconnectCount = 0;
		wsConnection.maxFailedReconnects = config.maxFailedReconnects || 15;
		wsConnection.debug = config.debug || true;
		wsConnection.connected = false;
		wsConnection.connectedOnce = false;
		wsConnection.receiptHandlers = {};
		wsConnection.subscribeHandlers = {};
		wsConnection.transports = config.transports || undefined;

		wsConnection.addReceiptHandler = function(id, onReceipt) {
			wsConnection.receiptHandlers[id] = onReceipt;
		}

		/**
		 * Adds a subscribe callback to be used on reconnect.
		 *
		 * @param id of the handler (e.g., Amelia Session ID).
		 * @param subscribeFn a subscribe function.
		 */
		wsConnection.addSubscribeHandler = function(id, subscribeFn) {
			wsConnection.subscribeHandlers[id] = subscribeFn;
		}

		/**
		 * Removes a subscribe handler by id. To be used on subscription.
		 * @param id
		 */
		wsConnection.removeSubscribeHandler = function(id) {
			delete wsConnection.subscribeHandlers.id;
		}

		/**
		 * Connect, subscribe, and invoked onConnectCallback.
		 *
		 * @private
		 */
		wsConnection.connect = function(csrfToken) {
			wsConnection.csrfToken = csrfToken;
			var options = { sessionId: 16 };
			if (wsConnection.transports !== undefined) {
				options.transports = wsConnection.transports;
			}
			var socket = new SockJS(ngrokHost + '/Amelia/api/sock', /** reserved * */ null, options);

			wsConnection.connection = webstomp.over(socket, {heartbeat: {incoming: 20000, outgoing: 20000}, debug: this.debug});

			wsConnection.connection.debug = function(msg) {
				//console.error(msg);
			};

			wsConnection.connection.onreceipt = function (frame) {
				var receiptId = frame.headers['receipt-id'];
				if (wsConnection.receiptHandlers[receiptId]) {
					wsConnection.receiptHandlers[receiptId]();
				} else {
					console.error('Received unexpected receipt id ' + receiptId);
				}
			};

			var headers = { 'X-CSRF-TOKEN': chat._csrfToken};
			if (chat._ameliaSessionId !== null && chat._ameliaSessionId !== undefined) {
				headers['X-Amelia-Session-Auth'] = chat._ameliaSessionId;
			}
			wsConnection.connection.connect(
				headers,
				function () {
					wsConnection.connected = true;
					wsConnection.failedReconnectCount = 0;
					wsConnection.resubscribeIfConnectedBefore();
				},
				function (error) {
					console.error('STOMP: ' + error);
					wsConnection.reconnect();
				}
			);
		}

		/**
		 * Reconnect.
		 * @private
		 */
		wsConnection.reconnect = function() {
			//console.error('Reconnecting to conversation web socket');
			wsConnection.disconnect();
			wsConnection.failedReconnectCount += 1;
			if (wsConnection.failedReconnectCount > wsConnection.maxFailedReconnects) {
				publicAmelia.fireEvent("sessionFail", 403, "SESSION_INVALID", "Too many failed reconnects");
				return;
			}
			setTimeout(publicAmelia.checkSession, wsConnection.reconnectDelayMs);
		};


		/**
		 * Disconnect.
		 */
		wsConnection.disconnect = function() {
			if (wsConnection.connection) {
				try {
					wsConnection.connection.disconnect();
				} catch (err) {
					console.error('Error disconnecting wsConnection', err);
				}
				wsConnection.connected = false;
			}
		}

		wsConnection.resubscribeIfConnectedBefore = function() {
			if (wsConnection.connectedOnce) {
				//console.debug('Re-subscribing...');
				for (var key in wsConnection.subscribeHandlers) {
					if (wsConnection.subscribeHandlers.hasOwnProperty(key)) {
						try {
							wsConnection.subscribeHandlers[key]();
						} catch (e) {
							console.error('Failed to subscribe to ' + key + ', ' + e);
						}
					}
				};
			} else {
				wsConnection.connectedOnce = true;
			}
		}

		return wsConnection;
	})

	// a Subscription for a join conversation topic
	var JoinConversationSubscription = (function(config) {
		var subscription = this;
		subscription.wsConnection = config.wsConnection;
		subscription.wsConnection.debug = function(msg) {
			//console.error(msg);
		};
		subscription.userId = config.userId;
		subscription.messageHandler = config.messageHandler;

		subscription.subscribe = function() {
			if (subscription.wsConnection.connected) {
				subscription._subscribe();
			} else {
				window.setTimeout(subscription.subscribe, 1000);
			}
		}

		subscription._subscribe = function() {
			if (!subscription.wsConnection.connected) {
				console.error('Attempt to subscribe over disconnected web socket');
			}

			var destination = '/topic/join-conversation-request.' + subscription.userId;
			//console.debug('Subscribing to ' + destination);

			var subResult = subscription.wsConnection.connection.subscribe(destination, function(message) {
				subscription.messageHandler(message);
			});

			subscription.unsubscribe = subResult.unsubscribe;
		}

	});

	// a Subscription for escalation topics
	var EscalationSubscription = (function(config) {
		var subscription = this;
		subscription.wsConnection = config.wsConnection;
		subscription.wsConnection.debug = function(msg) {
			//console.error(msg);
		};
		subscription.userId = config.userId;
		subscription.activeEscalations = {};
		subscription.messageHandler = function (message) {
			var msgBody = JSON.parse(message.body);
			subscription.activeEscalations[msgBody.escalationRequestId] = 'PENDING';
			publicAmelia.fireEvent('EscalationNotificationMessage', msgBody, message.headers);
			// automatically timeout according to the escalation's settings
			if (msgBody.escalationPopupTimeout) {
				window.setTimeout(function() {
					publicAmelia.fireEvent('EscalationTimeoutMessage', msgBody, message.headers);
					subscription.sendResponse('TIMEOUT', msgBody, message.headers);
				}, msgBody.escalationPopupTimeout * 1000);
			}
		}

		subscription.subscribe = function() {
			if (subscription.wsConnection.connected) {
				subscription._subscribe();
			} else {
				window.setTimeout(subscription.subscribe, 1000);
			}
		}

		subscription._subscribe = function() {
			if (!subscription.wsConnection.connected) {
				console.error('Attempt to subscribe over disconnected web socket');
			}

			var destination = '/topic/escalation.' + subscription.userId;
			//console.debug('Subscribing to ' + destination);


			var subResult = subscription.wsConnection.connection.subscribe(destination, function(message) {
				subscription.messageHandler(message);
			});

			subscription.unsubscribe = subResult.unsubscribe;
		}

		/**
		 * Unsubscribe from current session.
		 */
		subscription.unsubscribe = function() {
			if (subscription.unsubscribe) {
				subscription.unsubscribe.call();
			}
		}

		/**
		 * Send escalation response.
		 */
		subscription.sendResponse = function(reply, escalation) {
			var headers = {
				'X-Amelia-Escalation-Id': escalation.escalationId,
				'X-Amelia-User-Id': escalation.userId,
				'X-Amelia-Timestamp': new Date().getTime()
			};
			subscription.wsConnection.connection.send('/amelia/escalation.in', JSON.stringify({
				escalationId: escalation.escalationId,
				escalationRequestId: escalation.escalationRequestId,
				escalationResult: reply,
				userId: escalation.userId
			}), headers);
			delete subscription.activeEscalations[escalation.escalationRequestId];
		}
	});

	chat.acceptNotification = function(escalation) {
		if (!chat._escalationSubscription) {
			console.error("No active Escalation Subscription");
		} else {
			chat._escalationSubscription.sendResponse('ACCEPTED', escalation);
		}
	}

	chat.rejectNotification = function(escalation) {
		if (!chat._escalationSubscription) {
			console.error("No active Escalation Subscription");
		} else {
			chat._escalationSubscription.sendResponse('REJECTED', escalation);
		}
	}

	/**
	 * A SessionSubscription to a conversation
	 * @type {function(*=): *}
	 */
	var SessionSubscription = (function(config) {
		var subscription = this;
		subscription.wsConnection = config.wsConnection;
		subscription.sessionId = config.sessionId;
		subscription.conversationId = config.conversationId;
		subscription.onSubscribeCallback = config.onSubscribeCallback;
		subscription.messageHandler = config.messageHandler;
		subscription.onSubscribeCallbackCalled = false;
		subscription.debug = config.debug || false;
		subscription.queuedMessages = [];

		subscription.subscribe = function() {
			if (subscription.wsConnection.connected) {
				subscription._subscribe();
			} else {
				window.setTimeout(subscription.subscribe, 1000);
			}
		}

		subscription._subscribe = function() {
			if (!subscription.wsConnection.connected) {
				console.error('Attempt to subscribe over disconnected web socket');
			}

			var destination = '/queue/session.' + subscription.sessionId;
			//console.debug('Subscribing to ' + destination);

			// Request a receipt for the subscription request to ensure we are subscribed before sending any messages
			// over the web socket.
			var receiptId = 'subscribe-' + subscription.sessionId;

			// A reconnected stomp socket or a misbehaving UI may attempt to re-subscribe.  Make sure there is only
			// one subscription per conversation session by unsubscribing the old one
			if (chat._conversationsBySessionId[config.sessionId]
				&& chat._conversationsBySessionId[config.sessionId]._subscription) {
				chat._conversationsBySessionId[config.sessionId]._subscription.unsubscribe();
			}

			subscription.wsConnection.addReceiptHandler(receiptId, function() {
				if (!subscription.onSubscribeCallbackCalled && subscription.onSubscribeCallback) {
					subscription.onSubscribeCallbackCalled = true;
					subscription.onSubscribeCallback(subscription);
				}

				if (subscription.queuedMessages.length > 0) {
					var ele = subscription.queuedMessages.shift();
					while (ele !== undefined) {
						subscription.send(ele.messageBody, ele.messageType, ele.extraHeaders);
						ele = subscription.queuedMessages.shift();
					}
				}
			});

			subscription.wsConnection.addSubscribeHandler(subscription.sessionId, subscription.subscribe);
			var subResult = subscription.wsConnection.connection.subscribe(
				destination,
				function(message) {
					subscription.messageHandler(message);
				},
				{ receipt: receiptId });
			subscription._unsubscribe = subResult.unsubscribe;
		};

		/**
		 * Unsubscribe from current session.
		 */
		subscription.unsubscribe = function() {
			if (subscription._unsubscribe) {
				subscription._unsubscribe.call();
				subscription.wsConnection.removeSubscribeHandler(subscription.sessionId);
				// setup as listeners when we break this into classes
				if (chat._spokenQueues) {
					delete chat._spokenQueues[subscription.sessionId];
					delete chat._audioQueues[subscription.sessionId];
					delete chat._audioMaps[subscription.sessionId];
				}
			}
		}

		/**
		 * Send the given message.
		 */
		subscription.send = function(messageBody, messageType, extraHeaders) {
			if (!this.onSubscribeCallbackCalled) {
				this.queuedMessages.push({ messageBody:messageBody, messageType: messageType, extraHeaders: extraHeaders });
			} else {
				var headers = extraHeaders || {};
				applyIf(headers, {
					'X-Amelia-Session-Id': subscription.sessionId,
					'X-Amelia-Conversation-Id': subscription.conversationId,
					'X-Amelia-Message-Type': messageType,
					'X-Amelia-Timestamp': new Date().getTime()
				});
				subscription.wsConnection.connection.send('/amelia/session.in', JSON.stringify(messageBody), headers);
			}
		}

		return subscription;
	})

	/** An individual conversation with Amelia */
	var AmeliaConversation = (function(config) {
		var conversation = this;

		//internal properties that can differ between conversations
		conversation._domainCode = config.domainCode || 'global'; //default to global for demos
		conversation._languageCode = config.languageCode;
		conversation._sessionId = config.sessionId || null;
		conversation._conversationId= config.conversationId || null;
		conversation._customUpload = config.customUpload === true || false;
		conversation._subscription = config.subscription;
		conversation._conversationPartnerName = config.conversationPartnerName || 'Amelia';
		conversation._sessionMode = config.sessionMode || 'USER';
		conversation._inboundMessageType = config.sessionMode === 'AGENT' ? 'InboundAgentUtteranceMessage' : 'InboundUserUtteranceMessage';

		conversation._subscription.subscribe();

		//decorated
		conversation.unsubscribe = function() {
			conversation._subscription.unsubscribe();
		}

        conversation._checkEmotionalState = function(attributes) {
            if (attributes && attributes.emoticon) {
                if (conversation._mood !== attributes.emoticon) {
                    publicAmelia.fireEvent("moodChange", conversation.publicConversation, attributes.emoticon, conversation._mood);
                    conversation._mood = attributes.emoticon;
                    conversation.publicConversation.mood = attributes.emoticon;
                }
            }
        }

		conversation.changeLanguage = function(language, direction) {
			if (direction === 'both') {
				conversation._sendMessageToServer({"attributes": {"direction": 'in', "language": language}}, 'InboundChangeSessionLanguageMessage');
				conversation._sendMessageToServer({"attributes": {"direction": 'out', "language": language}}, 'InboundChangeSessionLanguageMessage');
			} else {
				conversation._sendMessageToServer({"attributes": {"direction": direction, "language": language}}, 'InboundChangeSessionLanguageMessage');
			}
		};

		/**
		 * tracks the current state of user input, if it is allowed or not
		 * @type {boolean}
		 * @private
		 */
		conversation._inputEnabled=false;

		/**
		 * tracks the current state of user input, if it is allowed or not
		 * @type {boolean}
		 * @private
		 */
		conversation._inputSecure=false;

		conversation._inputOffTheRecord=false;
		conversation._inputOffTheRecordBlocked=false;

		conversation._typing = false;

		conversation._pendingFormOnlySubmission = false;

		conversation._inReplay = false;

		/**
		 * toggle the input state and fire the message if needed
		 * @param attributes {object} the message attributes
		 * @param messageType {string}
		 * @param options {object} a hash to be fired in the event
		 * @private
		 */
		conversation._toggleSecureState=function(attributes, messageType, options) {
			if (chat._secureAbleMessageTypes.indexOf(messageType) > -1) {
				var newValue = attributes != null && attributes != undefined && true === attributes.secureResponse;
				if (conversation._inputSecure !== newValue) {
					if (newValue) {
						publicAmelia.fireEvent("inputMask", conversation.publicConversation, messageType, options);
					} else {
						publicAmelia.fireEvent("inputUnmask", conversation.publicConversation, messageType, options)
					}
					conversation._inputSecure = newValue;
				}
			}
		}

		/**
		 * toggle the input state and fire the message if needed
		 * @param attributes {object} the message attributes
		 * @param messageType {string}
		 * @param fromServer {boolean} true if fired from the server, false if from the user
		 * @param options {object} a hash to be fired in the event
		 * @private
		 */
		conversation._toggleOffTheRecordState=function(attributes, messageType, fromServer, options) {
			if (chat._offTheRecordAbleMessageTypes.indexOf(messageType) > -1) {
				var newValue = attributes != null && attributes != undefined && true === attributes.offTheRecordResponse;
				if (conversation._inputOffTheRecord !== newValue) {
					if (newValue === false) {
						if (fromServer || conversation._inputOffTheRecordBlocked === false) {
							conversation._inputOffTheRecord = newValue;
							conversation._inputOffTheRecordBlocked = fromServer;
							publicAmelia.fireEvent("inputOnTheRecord", conversation.publicConversation, messageType, options);
						} else {
							console.error("Blocked by policy");
						}
					} else {
						conversation._inputOffTheRecord = newValue;
						conversation._inputOffTheRecordBlocked = fromServer;
						publicAmelia.fireEvent("inputOffTheRecord", conversation.publicConversation, messageType, options);
					}
				}
			}
		}


		/**
		 * toggle the allowIntentDetection in form input if needed
		 * @param attributes {object} the message attributes
		 * @param messageType {string}
		 * @private
		 */
		conversation._toggleAllowIntentInFormInputState=function(attributes, messageType) {
			if (chat._allowIntentDetectionInFormInputTypes.indexOf(messageType) > -1) {
				var newValue = attributes != null && attributes != undefined && true === attributes.allowIntentDetectionInFormInput;
				if (conversation._allowIntentDetectionInFormInput !== newValue) {
					conversation._allowIntentDetectionInFormInput = newValue;
				}
			}
		}

		/**
		 * toggle the input state and fire the message if needed
		 * @param newValue {boolean}
		 * @param messageType {string}
		 * @param options {object} a hash to be fired in the event
		 * @private
		 */
		conversation._toggleInputState=function(newValue, messageType, options) {
			if (conversation._sessionMode === 'OBSERVER') {
				if (conversation._inputEnabled && newValue === false) {
					if (options == undefined || options.suppressEvent !== true) {
						publicAmelia.fireEvent("inputDisabled", conversation.publicConversation, messageType, options)
					}
					conversation._inputEnabled = newValue;
				}
			} else {
				if (conversation._inReplay !== true) {
					if (conversation._inputEnabled !== newValue) {
						if (newValue) {
							if (conversation._pendingFormOnlySubmission === false) {
								if (options == undefined || options.suppressEvent !== true) {
									publicAmelia.fireEvent("inputEnabled", conversation.publicConversation, messageType, options);
								}
								conversation._inputEnabled = newValue;
							} else if (options && options.force === true) {
								if (options.suppressEvent !== true) {
									publicAmelia.fireEvent("inputEnabled", conversation.publicConversation, messageType, options);
								}
								conversation._inputEnabled = newValue;
								conversation._pendingFormOnlySubmission = false;
							}
						} else {
							if (options == undefined || options.suppressEvent !== true) {
								publicAmelia.fireEvent("inputDisabled", conversation.publicConversation, messageType, options)
							}
							conversation._inputEnabled = newValue;
						}
					}
				}
			}
		}

        /**
         * checks and changes the input state if needed, based on the message and its headers.
         * @param msgBody
         * @param headers
         * @param the conversation whose input status to check
         * @private
         */
        conversation._checkInputStatus=function(msgBody, headers) {
            var shouldEnable;
            var options;
            switch (msgBody.messageType) {
                case "OutboundTextMessage":
                    //this is an awful hack because we are using OutboundTextMessage to complete an upload request
                    if (msgBody.attributes && typeof msgBody.attributes === 'object'
                        && msgBody.attributes.formInputData) {
                        if ("FORM_ONLY" === msgBody.attributes.formInputData.allowedUserInputs) {
                            shouldEnable = false;
                            conversation._pendingFormOnlySubmission = true;
                            options = {formRequest: true};
                        } else {
                            shouldEnable = true;
                        }
                        break;
                    } else {
                        if (msgBody.messageText && msgBody.messageText.indexOf('UPLOAD_REQUEST_MESSAGE_EVENT') !== -1) {
                            shouldEnable = false;
                            options = {uploadRequest: true};
                        } else {
                            shouldEnable = 'true' === headers['X-Amelia-Input-Enabled']
                        }
                    }
                    break;
                case "OutboundAckRequestMessage":
                    conversation._sendMessageToServer({}, "InboundAckMessage");
                    return;
                case "OutboundFormInputMessage":
                    if (msgBody.formInputData) {
                        if ("FORM_ONLY" === msgBody.formInputData.allowedUserInputs || "form_only" === msgBody.formInputData.allowedUserInputs) {
                            shouldEnable = false;
                            conversation._pendingFormOnlySubmission = true;
                        } else {
                            shouldEnable = true;
                        }
                        break;
                    }
                default:
                    shouldEnable = 'true' === headers['X-Amelia-Input-Enabled']
            }
            //publicAmelia.fireEvent("anyInputEnabled", msgBody.messageType, headers['X-Amelia-Input-Enabled'] === true);
            conversation._toggleInputState(shouldEnable, msgBody.messageType, options);
            conversation._toggleSecureState(msgBody.attributes, msgBody.messageType, options);
			conversation._toggleOffTheRecordState(msgBody.attributes, msgBody.messageType, true, options);
			conversation._toggleAllowIntentInFormInputState(msgBody.attributes, msgBody.messageType, options);
        }

        conversation._sendMessageToServer =function(messageBody, messageType) {
            var isUtterance = messageType === conversation._inboundMessageType; //'InboundUserUtteranceMessage' or 'InboundAgentUtteranceMessage' if agent;
			if (!conversation._inputEnabled && isUtterance === true) {
				publicAmelia.fireEvent('ErrorInputBlocked', conversation.publicConversation, conversation._conversationPartnerName, messageBody ? messageBody.messageText : undefined);
			} else {
				if (messageBody === null || messageBody === undefined) {
					messageBody = {};
				}
				messageBody.secure = conversation._inputSecure === true;
				messageBody.offTheRecord = conversation._inputOffTheRecord === true;
				messageBody.allowIntentDetectionInFormInput = conversation._allowIntentDetectionInFormInput === true;
				if (conversation._subscription) {
					conversation._subscription.send(messageBody, messageType);
					if (isUtterance) {
						conversation._toggleInputState(false, messageType);
					}
				} else {
					publicAmelia.fireEvent('ErrorNoActiveSubscription', conversation.publicConversation, conversation._conversationPartnerName, messageBody ? messageBody.messageText : undefined);
				}
			}
			if (messageType == 'InboundReplayConversationMessage') {
				conversation._toggleInputState(false, 'InboundReplayConversationMessage');
				conversation._inReplay = true;
				publicAmelia.fireEvent('conversationReplayStart', conversation.publicConversation, conversation._conversationId, {});
			}
		};

		conversation.publicConversation = {
			sessionMode: conversation._sessionMode,
			sessionId: conversation._sessionId,
			conversationId: conversation._conversationId,
			contextId: conversation._contextId,
			conversationPartnerName: conversation._conversationPartnerName,
			voice: conversation._voice,
			mood: conversation._mood,
			domainId: conversation._domainId,
			domainCode: conversation._domainCode,
			started:false
		}

		/**
		 * accessors to change mutable properties on the internal conversation *and* the public one we sent out in messages
		 */

		conversation._setConversationPartnerName = function(name) {
			conversation._conversationPartnerName = name;
			conversation.publicConversation.conversationPartnerName = name;
		}

		conversation._setVoice = function(newVoice) {
			conversation._voice = newVoice;
			conversation.publicConversation.voice = newVoice;
		}

		conversation._setDomain = function(domain) {
			conversation._domainCode = domain.code;
			conversation._domainId = domain.id;
			conversation._languageCode = domain.localeLanguageTag;
			conversation.publicConversation.domainCode = domain.code;
			conversation.publicConversation.domainId = domain.id;
			conversation.publicConversation.languageCode = domain.localeLanguageTag;
		}
		conversation._setContextId = function(contextId) {
			conversation._contextId = contextId;
			conversation.publicConversation.contextId = contextId;
		}
	})
	chat._AmeliaConversation = AmeliaConversation;

	chat.checkSession = function() {
		getJson('/Amelia/api/httpSession/check', chat._sessionHeaders({}), undefined, undefined,
			function(xhr) {
				try {
					if (xhr.responseText && xhr.responseText.length > 0) {
						var data = JSON.parse(xhr.responseText);
						if (data && data.success === true) {
							if (data.csrfToken) {
								chat._csrfToken = data.csrfToken;
							}
							chat._wsConnection.connect(chat._csrfToken);
						} else {
							_needingInit = true;
							delete chat._conversationsBySessionId;
							chat._conversationsBySessionId = {};
							chat._csrfToken = null;
							chat._data = undefined;
							chat._setUser(undefined);
							publicAmelia.fireEvent("sessionFail", xhr.status, "SESSION_INVALID", xhr.responseText);
						}
					}
				} catch (err) {
					_needingInit = true;
					delete chat._conversationsBySessionId;
					chat._conversationsBySessionId = {};
					chat._csrfToken = null;
					chat._data = undefined;
					chat._setUser(undefined);
					publicAmelia.fireEvent("sessionFail", xhr.status, "INVALID_JSON", xhr.responseText);
					return;
				}
			},
			function(xhr) {
				// keep trying - connect refused, restart, etc.
				chat._wsConnection.reconnect();
			})
	}

	/**
	 * Get the conversation according to the session id of a current message.
	 * @param message
	 * @returns {*}
	 * @private
	 */
	chat._getConversationByMessage= function(message) {
		return chat._conversationsBySessionId[message.headers['X-Amelia-Session-Id']];
	}

	chat._getConversationBySessionId = function(sessionId){
		if (sessionId) {
			return chat._conversationsBySessionId[sessionId] || { _empty: true};
		}
		return chat._getForegroundConversation();
	}

	/**
	 * Get the conversation currently in the foreground
	 * @returns {*}
	 * @private
	 */
	chat._getForegroundConversation = function() {
		return chat._conversationsBySessionId[chat.getSessionId()] || { _empty:true }
	}

	chat._getDomain = function() {
		if (chat.getDomainCode() === undefined || chat._domains[chat.getDomainCode()] === undefined) {
			return undefined;
		} else {
			return chat._domains[chat.getDomainCode()]
		}
	}

	chat._getVoice = function(sessionId) {
		return chat._getConversationBySessionId(sessionId)._voice || 'VW Julie';
	}

	chat.getLanguageCode = function() {
		return chat._getForegroundConversation()._languageCode || 'en-US';
	}

	chat.getInputEnabled = function() {
		return chat._getForegroundConversation()._inputEnabled || false;
	}

	/**
	 * Sets inputEnabled, forcing an inputEnabled message to fire only if options contains suppressEvent: true
	 * @param enabled true or false - the new state
	 * @param sessionId optional sessionId
	 * @params options optional options, defaults to suppressing firing of events back to the application
	 * @returns {*}
	 */
	chat.setInputEnabled = function(enabled, sessionId, options) {
		var opts = options || { suppressEvent: true };
		opts.force = true;
		var conversation;
		if (sessionId) {
			conversation = chat._getConversationBySessionId(sessionId);
		} else {
			conversation = chat._getForegroundConversation();
		}
		if (!conversation || conversation._empty) {
			return undefined;
		}
		return conversation._toggleInputState(enabled, 'Explicit', opts);
	}

	chat.getUserInterface = function() { return chat._userInterface;}
	chat._setUserInterface = function(userInterface) { chat._userInterface = userInterface;}

	chat.getCurrentMood = function(sessionId) { return chat._getConversationBySessionId(sessionId)._mood; }

	chat.getTimeOfLastMessage = function(sessionId) {
		return chat._getConversationBySessionId()._timeOfLastMessage;
	}

	var defaultInitialBpnVariablesFn = function() {
		var s = window.location.search.substring(1);
		var allHash = queryStringToHash(s);
        return queryStringToHash(s, function(key) {
        	if (allHash['bpn_'+key] !== undefined) {
        		return false;
			}
        	if (key.indexOf('bpn_') === 0) {
        		return key.substring(4)
			}
			return key;
		});
    };
    /**
	 * initialBpnVariables and initialConversationVariables are synonyms for the same ability - to provide initial variables
	 * to the opening BPN of a conversation when a conversation is kicked off.  They can take one of three forms:
	 *
	 * 1) initialConversationVariables: { name:"value" } an object
	 * 2) initialConversationVariables: { function() { return {name: "value" }
	 *
	 * if unspecified, will use above defaultInitialBpnVariablesFn
     */
	if (config.initialBpnVariables !== undefined) {
		config.initialConversationVariables = config.initialBpnVariables;
	}
	if (config.initialConversationVariables === undefined ) {
		chat._initialConversationVariables=defaultInitialBpnVariablesFn;
    } else if (typeof config.initialConversationVariables === 'object') {
		chat._initialConversationVariables = function() {
			if (config.initialBpnVariablesMerge === true) {
                return Object.assign({}, config.initialConversationVariables, defaultInitialBpnVariablesFn());
			} else {
				return config.initialConversationVariables;
			}
		};
	} else if (typeof config.initialConversationVariables === 'function') {
        chat._initialConversationVariables = function() {
            if (config.initialBpnVariablesMerge === true) {
                return Object.assign({}, config.initialConversationVariables(), defaultInitialBpnVariablesFn());
            } else {
                return config.initialConversationVariables();
            }
        };
	} else {
        chat._initialConversationVariables=defaultInitialBpnVariablesFn;
	}

    var defaultInitialConversationAttributesFn = function() {
        return queryStringToHash(window.location.search.substring(1), function(key, hash) {
            if (key.indexOf('attrib_') === 0) {
                return key.substring(7)
            }
            return false;
        });
    };

    /**
     * initialConversationAttributes provide initial attributes for a conversation when a conversation is kicked off
     * unlike bpn variables, they persist for the entire conversation, and can be overrwitten by calling the
     * setCustomConversationAttributes method later
     *
     * 1) initialConversationAttributes: { name:"value" } an object
     * 2) initialConversationAttributes: { function() { return {name: "value" }
	 *
	 * if unspecified, will use above defaultInitialConversationAttributesFn
     */
    if (config.initialConversationAttributes === undefined ) {
        chat._initialConversationAttributes= defaultInitialConversationAttributesFn;
    } else if (typeof config.initialConversationAttributes === 'object') {
        chat._initialConversationAttributes = function() {
            if (config.initialConversationAttributesMerge === true) {
                return Object.assign({}, config.initialConversationAttributes, defaultInitialConversationAttributesFn());
            } else {
                return config.initialConversationAttributes;
            }
        };
    } else if (typeof config.initialConversationAttributes === 'function') {
        chat._initialConversationAttributes=function() {
            if (config.initialConversationAttributesMerge === true) {
                return Object.assign({}, config.initialConversationAttributes(), defaultInitialConversationAttributesFn());
            } else {
                return config.initialConversationAttributes();
            }
        };
    } else {
        chat._initialConversationAttributes= defaultInitialConversationAttributesFn;
    }

    chat._defaultExtractLanguageFn = function() {
    	if (window.location.search !== undefined) {
			return queryStringToHash(window.location.search.substring(1)).language;
		}
    	return undefined;
	}

    chat._joinExtractLanguageFn = chat._defaultExtractLanguageFn;

	chat._minIdleTime = config.minIdleTime || 300000;
	chat._varIdleTime = config.varIdleTime || 600000;

	//v3 variables of use
    var _needingInit = true;

	// we do not get the actual amelia version, but we can distinguish between 3.7 and prior versions based on the user object
	// only
	chat._establishChatLevelByUser = function(user) {
		if (user && user.defaultConversationDomainId !== undefined
			&& user.passwordChangeAllowed !== undefined) {
			chat._is37OrHigher = true;
		} else {
			chat._is37OrHigher = false;
		}
	}

    /**
	 * initializes a session, invoking a callback when completed
     * @param onsuccess - a callback to invoke after the session is initialized
     */
	chat._initSession = function(onsuccess) {
	    if (_needingInit) {
            getJson('/Amelia/api/init', chat._sessionHeaders({}), function (xhr) {
                _needingInit = false;
            }, undefined, function (xhr) {
                _needingInit = true;
                var data;
                try {
                	if (xhr.getResponseHeader('x-amelia-session-auth')) {
                		chat._ameliaSessionId = xhr.getResponseHeader('x-amelia-session-auth');
					}
                    data = JSON.parse(xhr.responseText);
					if (data.csrfToken) {
						chat._csrfToken = data.csrfToken;
					}

                    if (data.appConfig) {
                        chat._appConfig = data.appConfig;
                        publicAmelia.fireEvent("appInit", chat._appConfig);
						if (data.appConfig.avatar === undefined || data.appConfig.avatar === null) {
							chat._playBml = chat._extractTextV3;
							chat._isV3 = true;
						} else {
							chat._playBml = chat._extractTextV4;
							chat._isV4 = true;
						}
                    }
                    if (data.csrfToken) {
                        chat._csrfToken = data.csrfToken;
                    }

					if ((data.user && data.user.anonymous === false) || (chat._allowAnonymous === true && data.appConfig && data.appConfig.allowAnonymous === true)) {
                        if (data.user) {
							if (!chat._wsConnection) {
								chat._wsConnection = new WebsocketConnection(chat._initialConfig);
								chat._wsConnection.connect(chat._csrfToken);
							}
							chat._setUser(data.user);
                            publicAmelia.fireEvent("userInit", chat._user);
						}
                        publicAmelia.fireEvent("loginSuccess", "success", data.user, {});
                    }
					//fetch domains appropriate to the user
					chat._fetchDomains(function (dxhr) {
						try {
							var dArr = chat._setDomains(JSON.parse(dxhr.responseText).content);
							publicAmelia.fireEvent("domainFetch", dArr);
						} catch (err) {
							publicAmelia.fireEvent("domainFetch", []);
						}

						if (typeof onsuccess === 'function') {
							onsuccess.call(chat, data);
						}
					}, function() {
						//a failure here is access denied for a not logged in user, allow to proceed
						if (typeof onsuccess === 'function') {
							onsuccess.call(chat, data);
						}
					});
                } catch (err) {
                    _needingInit = true;
                    chat._data = undefined;
                    chat._setUser(undefined);
                    publicAmelia.fireEvent("sessionFail", xhr.statusText, "INVALID_JSON", err.toString());
                    return;
                }
            }, function (xhr) {
                _needingInit = true;
                chat._data = undefined;
                chat._setUser(undefined);
                publicAmelia.fireEvent("sessionFail", xhr.status, xhr.statusText, xhr.respontText);
            });
        }
	}
	/**
	 * Initialize a chat
	 * @private
	 * @property publicAmelia the AmeliaChat instance
	 * @property session a hash with the X-CSRF-TOKEN and X-AMELIA-SESSION values for this user
	 * @event sessionfail causes AmeliaChat instance to fire an event when a session cannot be created
	 * @property a hash with the status code, status text, and response text of the failed request
	 *
	 * @todo non-anonymous logins, error handling
	 */
	chat._initialize = function(options) {
		chat._initSession(function(data) {
			if ((data.loggedIn === true && data.user.anonymous === false)|| data.appConfig.allowAnonymous === true) {
				if (chat._rejoin === false ) {
					chat._setDomainAndStart(options.domainCode || chat._initialConfig.domainCode);
				}
			} else {
				chat.initAuthSystems(function(systems) {
					if (chat._user === undefined || chat._user.anonymous === true) {
						chat.fireEvent('loginRequired', systems);
					}
					chat.fireEvent('appReady');
				});
			}
            return;
        });
	}

	chat.initialize = function(options) {
		chat._initSession(function(data) {
			// if we have *no* user, it is becuse the instance has *no* anonymous domains.  custom ui requires
			// this event however, so send it out empty

			if ((data.loggedIn === true && data.user.anonymous === false)|| data.appConfig.allowAnonymous === true) {
				if (chat._user !== null && chat._user !== undefined) {
					var rejoin = chat._rejoinIfPossible(data);
					if (rejoin === true) {
						//do not bother to continue if we rejoined
						return;
					}
					if (options && options.domainCode && chat._domains[options.domainCode]) {
						chat.setDomainCode(options.domainCode);
						chat._startWithDomain();
						return;
					}
					if (chat._canJoinDefaultDomain === true && chat._user
						&& chat._user.defaultConversationDomainId !== undefined) {
						var defaultDomain = chat._domainsById[chat._user.defaultConversationDomainId];
						if (defaultDomain) {
							if (chat._hasDomainBeenSet !== true) {
								chat.setDomainCode(defaultDomain.code);
								chat._startWithDomain();
								return;
							}
						}
					}
				}
				chat.fireEvent('appReady');
			} else {
				chat.initAuthSystems(function (systems) {
					if (chat._user === undefined || chat._user.anonymous === true) {
						chat.fireEvent('loginRequired', systems);
					}

					chat.fireEvent('appReady');
				});
			}
		})
	}

	/**
	 * Starts a new conversation
	 */
	chat.newConversation = function(options) {
		if (chat._appConfig && chat._wsConnection) {
            chat._newConversation(options || {});
		} else {
			chat._initialize(options || {});
		}
	};

	chat._newConversation = function(options) {
		try {
			if (chat.getConversationId() != null && chat._multipleConversationMode === false) {
				chat._sendMessageToServer({}, "InboundConversationClosedMessage");
				chat._pendingResetConversation = options || true;
			} else {
                chat._startWithDomain(options);
            }
		} catch (err) {
			publicAmelia.fireEvent("conversationFail", -1, "unknown error starting conversation", err.toString());
		}
	}

    chat._domains={};
	chat._domainsById={};
	chat._visibleDomains=[];
	//set the domains on the chat in a map keyed by code and id for lookups, but return the visible array
	chat._setDomains=function(domains) {
	    chat._domains={};
	    chat._domainsById={};
	    chat._visibleDomains = [];
	    for (var i=0;i<domains.length;i++) {
            chat._domains[domains[i].code]=domains[i];
			chat._domainsById[domains[i].id]=domains[i];
	        if (chat._includeHiddenDomains === true || domains[i].hidden !== true) {
                chat._visibleDomains.push(domains[i]);
            }
        }
        return chat._visibleDomains;
    }

   chat.getMyOpenConversations = function(autojoin, lastActiveConversation) {
		if (chat._multipleConversationMode === true) {
			// if we do not, check from my/open, if available on this Amelia
			getJson('/Amelia/api/conversations/my/open', chat._sessionHeaders({}),
					function () {
					},
					undefined,
					function (xhr) {
						try {
							var data = JSON.parse(xhr.responseText);
							if (data && data.content.length > 0) {
								if (autojoin === true) {
									//AM3-8970 non anonymous users are allowed to pick up their conversations from a different session
									if (chat._user) {
										var lastActiveConversationId = lastActiveConversation
																	   ? lastActiveConversation.conversationId : undefined;

										var userConvs = data.content.filter(function (conv) {
											return conv.conversationId !== lastActiveConversationId;
										})
										//can these have different modes?
										for (var i = 0; i < userConvs.length; i++) {
											chat._joinExistingConversation(userConvs[i], false);
										}
									}
								} else {
									publicAmelia.fireEvent('conversationopenlist', data.content);
								}
							} else {
								if (autojoin !== true) {
									publicAmelia.fireEvent('conversationopenlist', []);
								}
							}
						} catch (err) {
							publicAmelia.fireEvent('conversationopenlistfail', err);
						}
					}, function (xhr) {
					if (autojoin) {
						publicAmelia._switchDomainAndStart();
					} else {
						publicAmelia .fireEvent('conversationopenlistfail', xhr.statusText);
					}
				});
		}
    }

    chat._fetchDomains=function(success, failure) {
        getJson('/Amelia/api/domains',
                chat._sessionHeaders({}),
                undefined,
                undefined,
                success,
                failure);
    }

    chat._rejoinIfPossible = function(initialData) {
		if ('object' === typeof config.rejoin) {
			if (chat._user && chat._user.anonymous === false) {
				if (config.rejoin.conversationId) {
					if (config.rejoin.sessionMode === 'AGENT') {
						chat._pickupConversation(config.rejoin.conversationId, config.rejoin);
						return true;
					} else if (config.rejoin.sessionMode === 'OBSERVER') {
						chat._observeConversation(config.rejoin.conversationId, config.rejoin);
						return true;
					}
				}
			}
		}

		var lastActiveConversation = initialData == undefined ? undefined : initialData.lastActiveConversation;
		//chat.getMyOpenConversations(true, config.rejoin, lastActiveConversation);

		if (chat._rejoin === true) {
			// if we have initialData.lastActiveConversation, we can start from that
			if (lastActiveConversation !== undefined && lastActiveConversation !== null
				&& lastActiveConversation.conversationId !== undefined
				&& lastActiveConversation.conversationId !== null) {
				chat._joinExistingConversation(initialData.lastActiveConversation, true);
				chat._rejoin = false;
				return true;
			}
		}
		return false;
	}

	chat._setDomainAndStart = function(domainCode) {
		switch (domainCode) {
			case '_automatic' :
			case '' :
			case undefined:
				// if we have gotten this far, we need to start a new conversation
				// 3.7 will start a conversation automatically, if it can and no domainCode has been specified yet
				if (chat._user && chat._user.defaultConversationDomainId !== undefined) {
					var defaultDomain = chat._domainsById[chat._user.defaultConversationDomainId];
					if (defaultDomain) {
						if (chat._hasDomainBeenSet !== true) {
							chat.setDomainCode(defaultDomain.code);
							chat._startWithDomain({domainCode:defaultDomain.code});
							return;
						}
					}
				}
				chat._domainCode = undefined;
				switch (chat._visibleDomains.length) {
				   case 0:
					   publicAmelia.fireEvent("domainFail", "ERROR_NO_DOMAIN", "unable to obtain a domain for this user");
					   break;
				   case 1:
					   chat.setDomainCode(chat._visibleDomains[0].code);
					   chat._startWithDomain(chat._visibleDomains[0].code);
					   break;
				   default:
					   publicAmelia.fireEvent("domainFetch", chat._visibleDomains);
			   }
				break;
			case '_manual':
				chat._domainCode = undefined;
				if (chat._visibleDomains.length === 0) {
					chat._fetchDomains(function (xhr) {
					   chat._domainCode = undefined;
					   var dArr = chat._setDomains(JSON.parse(xhr.responseText).content);
					   publicAmelia.fireEvent("domainFetch", dArr);
				   },
				   function () {
					   publicAmelia.fireEvent("domainFail", "ERROR_DOMAIN", xhr.statusText);
				   });
				} else {
					publicAmelia.fireEvent("domainFetch", chat._visibleDomains);
				}
				break;
			default:
				if (chat._domains[chat.getDomainCode()] === undefined) {
					publicAmelia.fireEvent("domainFail", "ERROR_INVALID_DOMAIN", "unable to obtain domain "
						+ chat.getDomainCode() + " for this user");
				} else {
					chat._startWithDomain();
				}
		}
	}

	chat._pickupConversation = function(conversationId, options) {
		var payload = options || {};
		payload.sessionMode = 'OBSERVER'; //override this in payload, AGENTS join as observers and send a message after
		applyIf(payload, {
			sessionMode: "OBSERVER",
			clientTimestamp: new Date().getTime(),
			channel: chat.channels['AGENT'] || 'js_sdk'});
		chat._internalConnectConversation('/Amelia/api/conversations/' + conversationId + '/join',
			{ conversationId: conversationId }, 'AGENT', payload);
	}

	chat._observeConversation = function(conversationId, options) {
		var payload = options || {};
		applyIf(payload, {
			sessionMode: "OBSERVER",
			clientTimestamp: new Date().getTime(),
			channel: chat.channels['OBSERVER'] || 'js_sdk'});
		chat._internalConnectConversation('/Amelia/api/conversations/' + conversationId + '/join',
			{ conversationId: conversationId }, 'OBSERVER', payload);
	}

	chat._joinExistingConversation = function(conversationStruct, makeForeground, options) {
		var language = options && options.sessionLocale ? options.sessionLocale : chat._joinExtractLanguageFn();
		chat._internalConnectConversation('/Amelia/api/conversations/' + conversationStruct.conversationId + '/join',
		conversationStruct, 'USER', makeForeground,
		{ sessionMode: "USER",
			userInterface: "WEB_USER",
			clientTimestamp: new Date().getTime(),
			sessionLocale: language,
			channel: chat.channels['USER'] || 'js_sdk'
		}, 'join');
	}

	chat._internalConnectConversation = function(url, conversationStruct, mode, makeForeground, payload, type) {
        delete payload.conversationId; //this should not go, its in the URL

		postJson(url,
				 chat._sessionHeaders({ "Content-Type" : "application/json"}),
				 undefined,
				 JSON.stringify(payload),
				 undefined,
				 undefined,
				 function (xhr) {
					 var data;
					 try {
						 data = JSON.parse(xhr.responseText);
					 } catch (err) {
						 publicAmelia.fireEvent("conversationFail", "INVALID_JSON", err.toString());
						 return;
					 }
					 //console.debug("start conversation "  + xhr.responseText);
					 var conversationId = conversationStruct.conversationId || data.conversationId;
					 var contextId = conversationStruct.contextId || data.contextId;

					 chat._subscribe(mode, {
						 conversationId: conversationId,
						 contextId: contextId,
						 sessionId: data.sessionId,
						 languageCode: data.lang ? options.newLang : undefined
					 }, type);

					 //3.7 domain can differ depending on way to get here
					 var domainCode = payload.domainCode || undefined;
					 var domainId = data.domainId || undefined;
					 var domainCheck = domainId === undefined ?
                       function(domain) {
                            return domain.code === domainCode;
                       } :
                       function(domain) {
                           return domain.id === domainId;
                       };

					 var conversation = chat._getConversationBySessionId(data.sessionId);
					 //notify other container to start from scratch, include the conversationId and the domainCode now,
					 // so anything that receives these events currently can do what they want.

					 for (var idx = 0; idx < chat._visibleDomains.length; idx++) {
						 if (domainCheck(chat._visibleDomains[idx]) === true) {
							 chat.setDomainCode(chat._visibleDomains[idx].code);
							 conversation._setDomain(chat._visibleDomains[idx]);
							 break;
						 }
					 }
					 conversation.publicConversation.started = true;
					 if (makeForeground === true || chat._foreGroundSessionId === null) {
						 chat.switchConversation(data.sessionId);
					 }
					 publicAmelia.fireEvent("conversationStart", conversation.publicConversation, data.sessionId,
												conversationId, conversation.publicConversation.domainCode);

					 if (mode !== 'USER' || type === 'join') {
						 conversation._inReplay = true;
						 conversation._toggleInputState(false, 'InboundReplayConversationMessage');
						 publicAmelia.fireEvent('conversationReplayStart', conversation.publicConversation, chat.getConversationId(), {});
					 }
				 },
				 function(xhr) {
					 publicAmelia.fireEvent("conversationFail", xhr.status, xhr.statusText, xhr.responseText);
				 }
		);
	}
    /**
     * starts a connection for a UI and a domain
     * @event conversationStart causes AmeliaChat instance to throw a conversationStart event
     * @property a hash with the AmeliaChat instance, and a hash with the conversationId, sessionId, and domainCode of the chat
     * @event conversationFail causes AmeliaChat instance to fire an event when a conversation cannot be created
     * @property a hash with the status code, status text, and resposne text of the failed request
     *
     */
    chat._startWithDomain=function(options) {
    	var domainCode;
    	if (options) {
			if (options.domainCode) {
				domainCode = options.domainCode;
			} else {
				domainCode = chat.getDomainCode();
			}
		} else {
			domainCode = chat.getDomainCode();
		}
        if (domainCode === undefined) {
            publicAmelia.fireEvent("conversationFail", "MISSING_DOMAIN", "A valid domain is required to start a conversation");
            return;
        }

        chat._messages = new Queue();

        var payload = {
        	domainCode: domainCode,
			clientTimestamp: new Date().getTime(),
			userInterface: chat.getUserInterface(), // pre-3.7
			channel: chat.channels['USER'] || 'js_sdk' // 3.7+
		}

        var bpnVars = chat._initialConversationVariables();
		if (options && options.initialBpnVariables) {
			bpnVars = Object.assign(bpnVars || {}, options.initialBpnVariables);
		}
        if (bpnVars !== undefined) {
            payload.initialBpnVariables=bpnVars;
        }
        var convAtts = chat._initialConversationAttributes();
		if (options && options.initialConversationAttributes) {
			convAtts = Object.assign(convAtts || {}, options.initialConversationAttributes);
		}
        if (convAtts != null) {
        	payload.initialAttributes = convAtts;
		}
		if (options && options.sessionLocale) {
			payload.sessionLocale = options.sessionLocale;
		} else {
			payload.sessionLocale = chat._defaultExtractLanguageFn() || 'auto';
		}
		//establish the language of the conversation and fire event, if necessary
		var oldLang = chat._languageCode;
		var newLang = chat._getDomain() === undefined ? chat._languageCode : payload.sessionLocale || chat._getDomain().localeLanguageTag;
		if (oldLang !== newLang) {
			publicAmelia.fireEvent("languageChange", {}, newLang, oldLang);
		}
		chat._languageCode = newLang;

        chat._internalConnectConversation('/Amelia/api/conversations/new', {}, 'USER', true, payload)

    }

    chat.joinConversation = function(conversationId, options) {
    	options = options || {};
    	var sessionMode = options.sessionMode || 'USER';

    	if (sessionMode === 'USER') {
			chat._joinExistingConversation({ conversationId: conversationId }, options.makeForeGround || true, options);
		} else if (sessionMode === 'OBSERVER') {
    		chat.observeConversation(conversationId, options);
		} else if (sessionMode === 'AGENT') {
    		chat.pickupConversation(conversationId, options);
		}
	}

    chat.observeConversation = function(conversationId, options) {
		var payload = options || {};
		delete payload.after;
		applyIf(payload, {
			sessionMode: "OBSERVER",
			clientTimestamp: new Date().getTime(),
			channel: chat.channels['OBSERVER'] || 'js_sdk'});
		chat._internalConnectConversation('/Amelia/api/conversations/' + conversationId + '/join',
			{ conversationId: conversationId }, 'OBSERVER', true, payload);
	}

    chat.pickupConversation = function(conversationId, options) {
		var payload = options || {};
		delete payload.after;
		payload.sessionMode = 'OBSERVER'; //override this in payload, AGENTS join as observers and send a message after
		applyIf(payload, {
			sessionMode: "OBSERVER",
			clientTimestamp: new Date().getTime(),
			channel: chat.channels['AGENT'] || 'js_sdk'});
		chat._internalConnectConversation('/Amelia/api/conversations/' + conversationId + '/join',
			{ conversationId: conversationId }, 'AGENT', true, payload);
    }

    chat._sessionHeaders = function(headers) {
		var result = headers || {};
		result["Origin"] = "https://gludington.github.io"
        if (chat._csrfToken !== null && chat._csrfToken !== undefined) {
			result["X-CSRF-TOKEN"] = chat._csrfToken;
		}
		if (chat._ameliaSessionId !== null && chat._ameliaSessionId !== undefined) {
			result['X-Amelia-Session-Auth'] = chat._ameliaSessionId;
		}
        return result;
    }

    /**
	 * Subscribe to a chat
	 *
	 * @param mode
	 * @param typejoin or anything else means start
	 * @event onconnect causes public Amelia instance to fire an onconnect event with instance
	 * @property publicAmelia the AmeliaChat instance
	 * @event messagereceived causes public Amelia instance to fire a messagereceived message when the server sends a message
	 * @property publicAmelia the AmeliaChat instance
	 * @property message the raw message from the server
	 * @event dynamic events, based on the name of the message sent from the server
	 * @property publicAmelia the AmeliaChat instance
	 * @property messageType the type of the incoming message
	 * @property msgBody the body of the message
	 * @property headers the headers of the message
	 * @private
	 */
	chat._subscribe = function(mode, conversation, type) {

		//chat._foreGroundSessionId = conversation.sessionId;
		var startupMessageTypes = [];
		switch (mode) {
			case "USER" :
				startupMessageTypes.push({ msgBody: {}, msgType: "join" === type ? 'InboundReplayConversationMessage' : 'InboundStartConversationMessage'});
				break;
			case "AGENT" :
				startupMessageTypes.push({ msgBody: {}, msgType: 'InboundReplayConversationMessage'});
				startupMessageTypes.push({ msgBody: {}, msgType: 'InboundAgentPickupMessage'});
				break;
			case "OBSERVER" :
				startupMessageTypes.push({ msgBody: {}, msgType:'InboundReplayConversationMessage'});
				conversation._inputEnabled = false;
				publicAmelia.fireEvent("inputDisabled", 'InboundReplayConversationMessage', { sessionMode: 'OBSERVER'});
				break;
			default :
				//console.log("Unknown mode: " + mode);
		}

		/**
		 * toggle the input state and fire the message if needed
		 * @param newValue {boolean}
		 * @param messageType {string}
		 * @param options {object} a hash to be fired in the event
		 * @private
		 */
		chat._toggleInputState=function(newValue, messageType, options) {
			chat._getForegroundConversation()._toggleInputState(newValue, messageType, options);
		}

		/**
         * Starts a new conversation
         */
		var onSubscribeCallback = function (sub) {
			for (var i= 0;i < startupMessageTypes.length;i++) {
				sub.send(startupMessageTypes[i].msgBody, startupMessageTypes[i].msgType, {});
			}
			publicAmelia.fireEvent("onconnect");
		};

		//a utility function to reset the time
		var resetTime = function(message, messageBody, conversation) {
			conversation._timeOfLastMessage = new Date().getTime();
		}

        /**
         * drain the message queue if needed.  ordinarily used after an present lemma, when the real message is not
         * fired out to the client code until after an XHR request returns.
         */
        var fireMessageQueueIfNeeded = function() {
            while (chat._messages.peek() !== undefined && chat._messages.peek().ready === true) {
                var msg = chat._messages.dequeue();
                publicAmelia.fireEvent("messageReceived", msg.conversation, msg.message);
                publicAmelia.fireEvent(msg.msgBody.messageType, msg.conversation, msg.msgBody.messageType, msg.msgBody, msg.message.headers);
            }
        }

		//must be last in the chain or return false to prevent the chain from continuing
        var transformMultimedia = function(message, messageBody, conversation) {
        	if (messageBody.resourceToPresent) {
                var resource = messageBody.resourceToPresent;
                var msgToEnqueue = {id: messageBody.id, msgBody: messageBody, message: message,
					conversation: conversation.publicConversation, ready: false}
				chat._messages.enqueue(msgToEnqueue);
				var params = {
					conversationId: messageBody.conversationId,
					bucketName: resource.bucketName,
					fileName: resource.filename,
					sessionId: message && message.headers ? message.headers['X-Amelia-Session-Id'] : chat.getSessionId()
				}
				var contextId = messageBody.contextId || chat.getContextId();
                if (contextId !== null && contextId !== undefined) {
					params.contextId = contextId
				}
				if (resource.processInstanceId !== undefined && resource.processInstanceId !== null) {
                	params.processInstanceId = resource.processInstanceId;
				}

				postJson('/Amelia/api/cm/download/', chat._sessionHeaders({'Content-type': 'multipart/form-data'}), params,
						 undefined, undefined, function (xhr) {
                    xhr.responseType = 'blob';
                }, function (xhr) {
                    var url = window.URL.createObjectURL(xhr.response);
                    var blob = new Blob([xhr.response]);
                    msgToEnqueue.ready = true;
                    msgToEnqueue.msgBody.resourceToPresent.url = url;
                    msgToEnqueue.msgBody.resourceToPresent.blob = blob;
                    msgToEnqueue.msgBody.resourceToPresent.contentType = xhr.getResponseHeader('content-type');
                    fireMessageQueueIfNeeded();
                }, function () {
                    var html = 'Unable to retrieve file';
                    messageBody.messageText = html;
                    msgToEnqueue.ready = true;
                    fireMessageQueueIfNeeded();
                })
                //if we are in this, we want to *NOT* publish the event here, but only in the callback
                return false;
            } else {
        		// if we do not have a resourceToPresent, pass it on, so that other things can use the raw message
        		return true;
			}

        }

		//a utility function to suppress firing of a message publicly
		var noFire = function() {
			return false;
		};

		/**
		 * gets a parameter from a querystring by name
		 * @param name
		 * @param url
		 * @returns {*}
		 */
		var getParameterByName= function(name, url) {
			var querystring = url.substring(url.indexOf('?')+1).split('&amp;');
			var params = {}, pair, d = decodeURIComponent;
			for (var i = querystring.length - 1; i >= 0; i--) {
				pair = querystring[i].split('=');
				params[d(pair[0])] = d(pair[1]);
			}
			return params[name];
		};

		/**
		 * checks to see if the messageBody is the result of a file upload request
		 *
		 * @param message
		 * @param messageBody
		 * @returns {boolean}
		 */
		var isFileUploadEcho = function(message, messageBody) {
			if (messageBody.messageText === null || messageBody.messageText === undefined) {
				return false;
			}
			if (messageBody.messageText.indexOf('getFile') != -1) {
				var text = messageBody.messageText;
				var urlPattern = /(https?:\/\/[^\s]+)/g;
				var url = text.replace(urlPattern, '$1');
				var fileName = getParameterByName('name', url);
				return !(fileName === undefined || fileName === null || fileName.indexOf("was successfully uploaded") > -1);
			}
		}


		var uploadHandler = function(message, messageBody, conversation) {
			internalUploadHandler(messageBody.messageText,
								  messageBody.fromUserDisplayName,
								  messageBody.cancellable === true,
								  messageBody.multiple === true,
								  messageBody.hintText,
								  messageBody.resourceToRequest || messageBody.resource_to_request,
								  conversation,
								  false);
			messageBody.messageText = '';
		}

		/**
		 * triggers the internal uploader in unsolicited mode.  Should only be called if a human agent is present in the
		 * conversation.  Has no effect if a custom uploader is being used.
		 */
		chat.unsolicitedUpload = function(sessionId) {
			var conversation = chat._getConversationBySessionId(sessionId);
			if (conversation === null || conversation === undefined) {
				conversation = chat._getForegroundConversation();
			}
			internalUploadHandler("", "", true, false, undefined, undefined,
								  conversation, true);
		}

		/**
		 * Submit files that have been placed in the internal uploader.  Has no effect if a custom uploader is being used.
		 */
		chat.submitUpload = function() {
			if (chat._dropzone) {
				chat._dropzone.processQueue();
			}
		}

		var internalUploadHandler = function(
			text, fromUserDisplayName, cancellable, multiple, hintText, resourceToRequest, conversation, unsolicited) {
			//message, messageBody, conversation) {
			if (chat._customUpload !== true) {

				//we need to handle uploads differently if on amelia 3.7 (which does not upload some portions) vs amelia 3.6 (which does)
				if (unsolicited === true || resourceToRequest) {

					if (cancellable) {
						conversation._pendingCancellableRequest = true;
					}

					var cmObjectType;
					var supportedFileTypes;
					var maxSize;

					var _changeFileName = function (filename) {
						return encodeURIComponent(filename.replace(/\s/g, '_'));
					};
					var supportedTypes;
					var fileExtensions;
					if (resourceToRequest) {
						cmObjectType = resourceToRequest.cmObjectType;
						supportedFileTypes = resourceToRequest.supportedFileTypes;
						maxSize = resourceToRequest.maxSize;

						if (resourceToRequest.supportedTypes) {
							var sArr = [];
							for (var i = 0; i < resourceToRequest.supportedTypes.length; i++) {
								for (var j = 0; j < resourceToRequest.supportedTypes[i].fileExtension.length; j++) {
									sArr.push('.' + resourceToRequest.supportedTypes[i].fileExtension[j]);
								}
							}
							supportedTypes = sArr.join(',');
						} else {
							supportedTypes = '*';
							if (resourceToRequest.fileExtensions && resourceToRequest.fileExtensions.length > 0) {
								fileExtensions = resourceToRequest.fileExtensions[0];
								for (var i = 1; i < resourceToRequest.fileExtensions.length; i++) {
									fileExtensions += ',' + resourceToRequest.fileExtensions[i];
								}
							}

						}
					}

					// uses private objects of Dropzone 4.3.0 to detach dropzone for reconfiguration.  Do not update dropzone
					// without verifying this section
					if (chat._dropzone) {
						var idx = Dropzone.instances.indexOf(chat._dropzone);
						if (idx > -1) {
							var dz = Dropzone.instances.splice(idx, 1);
							if (dz && dz.length > 0) {
								dz[0].disable();
								dz[0].element.dropzone = undefined;
								dz[0] = undefined;
							}
							chat._dropzone = undefined;
						}
					}

					var params = {
						conversationId: conversation._conversationId,
						unsolicited: unsolicited
					}
					var acceptedFiles;
					var contextId = conversation._contextId || chat.getContextId();
					//if undefined, we are still on amelia 3.6, and do not submit this
					if (contextId === null || contextId === undefined) {
						params.resourceType = cmObjectType;
						acceptedFiles = supportedTypes === undefined ? null : supportedTypes;
					} else {
						acceptedFiles = fileExtensions;
						if (acceptedFiles !== null && acceptedFiles !== undefined) {
							acceptedFiles = '.' + acceptedFiles.replace(/,/g, ",.");
						}
					}
					var dzContainer = document.getElementById('fileUpload');
					var dz = document.getElementById('fileUploadDz');
					if (dz === undefined || dz === null) {
						dz = document.createElement('div');
						dz.id = 'fileUploadDz';
						dz.innerHTML='';
						dz.style.width = '250px';
						dz.style.height = '250px';
						dz.style.zIndex = dzContainer.style.zIndex + 1;
						dzContainer.appendChild(dz);
					}
					var dzConfirm = document.getElementById('fileUploadConfirm');
					if (dzConfirm === undefined || dzConfirm === null) {
						dzConfirm = document.createElement('div');
						dzConfirm.id = 'fileUploadConfirm';
						dzConfirm.innnerHTML='Confirm';
						dzConfirm.style.width = '75px';
						dzConfirm.style.height = '75px';
						dzConfirm.style.zIndex = dzContainer.style.zIndex + 1;
						dzContainer.appendChild(dzConfirm);
					}
					dzConfirm.onclick=function() {
						chat._dropzone.processQueue();
						return false;
					}

					var dzCancel = document.getElementById('fileUploadCancel');
					if (dzCancel === undefined || dzCancel === null) {
						dzCancel = document.createElement('div');
						dzCancel.id = 'fileUploadCancel';
						dzCancel.innnerHTML='Cancel';
						dzCancel.style.width = '75px';
						dzCancel.style.height = '75px';
						dzCancel.style.zIndex = dzContainer.style.zIndex + 1;
						dzContainer.appendChild(dzCancel);
					}
					dzCancel.style.visibility = (conversation._pendingCancellableRequest === true ? 'visible' : 'hidden');
					dzCancel.onclick=function() {
						if (conversation._pendingCancellableRequest === true) {
							chat.cancelRequest({}, conversation._sessionId);
							chat._dropzone.destroy();
						}
						return false;
					}

					chat._dropzone = new Dropzone("div#fileUploadDz", {
						preventDropOnDocument: true,
						maxFilesize: maxSize === undefined ? 10 : maxSize / 1000 / 1000, //MB, dropzone uses 1000 as base
						autoProcessQueue: false,
						acceptedFiles: acceptedFiles,
						renameFilename: _changeFileName,
						params: params,
						url: function (upload) {
							return chat.getUploadUrl();
						},
						headers: chat.getUploadHeaders(),
						success: function (file, response, event) {
							var filename = _changeFileName(file.name);
							if (response === 'Error') {
								publicAmelia.fireEvent("uploadFail", fromUserDisplayName, filename, cmObjectType,
													   resourceToRequest);
							} else {
								//is this necessary or do we just need this to trigger resposne in extjs?
								var absUrl = document.createElement('a');
								absUrl.href = response;
								conversation._toggleInputState(true, 'Upload', {uploadRequest: true});
								var fileUploadSuccessMessage = 'The file ' + absUrl.cloneNode(false).href + '&fileName=' + filename
															   + ' was successfully uploaded.';
								var json;
								if (unsolicited === true) {
									if (typeof response === 'object') {
										json = response;
									} else {
										try {
											json = JSON.parse(response);
										} catch (err) {
											json = response;
										}
									}
								}
								chat.confirmUpload(fileUploadSuccessMessage, json, true, conversation._sessionId);
								publicAmelia.fireEvent("uploadSuccess", fromUserDisplayName,
													   filename, response + '&fileName=' + filename);
							}
						}, error: function (file, message, xhr) {
							var filename = '';
							if (file && file.name) {
								filename = file.name;
							}
							publicAmelia.fireEvent("uploadFail", fromUserDisplayName, filename, cmObjectType,
												   resourceToRequest);

						}
					});
				}
			}
		}

		var parseFormData = function(message, messageBody) {
			if (messageBody.attributes && messageBody.formInputData) {
                try {
                    messageBody.formInputData = JSON.parse(messageBody.formInputData);
                } catch (err) {
                    //console.error("Unable to parse formInputData: " + messageBody.attributes.formInputData);
                }
            }
            if (messageBody.attributes && messageBody.attributes.formInputData) {
                try {
                    messageBody.attributes.formInputData = JSON.parse(messageBody.attributes.formInputData);
                } catch (err) {
                    //console.error("Unable to parse formInputData: " + messageBody.attributes.formInputData);
                }
            }
		}
		// Handlers to perform parsing specific to an individual message type; done before internalHandlers to these valeus
		// are available to common handlers, particularly those like checking input status, which can rely on the presence
		// of formInputData
		var additionalInternalParsers = {
			OutboundIntegrationMessage:function(message, messageBody, conversation) {
				try {
                    messageBody.integrationMessageData = JSON.parse(messageBody.integrationMessageData);
				} catch (err) {
					//console.error("Unable to parse integrationMessageData: " + err);
				}
                try {
                    messageBody.attributes.integrationMessageData = JSON.parse(messageBody.attributes.integrationMessageData);
                } catch (err) {
                    //console.error("Unable to parse integrationMessageData: " + err);
                }
			},
			OutboundFormInputMessage:parseFormData,
            OutboundTextMessage:parseFormData
		};

		// An array of handlers to create a preprocessing "pipeline"; if any method in the chain returns false, the message
		// is not published externally.  This means each chain is allowed one and exactly one asynchronous handler, and it must
		// come last in the list and fire the messages in its final callback.  //TODO make a real chain if we need it
		var internalHandlers = {

			// from ConversationController.js in standard UI
            OutboundDeepDmStatusMessage: [noFire], //analytic memory only?
			OutboundDomainChangeMessage: [resetTime, function(message, messageBody, conversation) {
				var newDomain = chat._domainsById[messageBody.newDomainId];
				if (newDomain) {
					chat.setDomainCode(newDomain.code);
				}
			}], //for when a domain changes
            OutboundParaphraseStatusMessage: [noFire], //does not show up in standard UI
            OutboundCharacterAffectUpdateStatusMessage: [resetTime], //appears to set mood vars in affective.js
			OutboundUserSatisfactionUpdateStatusMessage: [resetTime], //appears to set mood vars in affective.js
            OutboundBmlStatusMessage: [],//think we need this to map non-spoken bml
            OutboundTextMessage: [resetTime ], //V2 outbound finaltextmessage, have to check file and multimedia stuff
            OutboundEchoMessage: [resetTime, isFileUploadEcho], //same as v2, have to check file and multimedia stuff
            OutboundParseStatusMessage: [noFire], //semantic SecondLane MindTicker
            OutboundUserAffectUpdateStatusMessage: [ resetTime ], //appears to set mood vars in affective.js
            OutboundBpnExecutionEventMessage: [ ], //secondlane MindTicker
            OuboundFormInputMessage: [resetTime],
            OutboundIntegrationMessage: [resetTime],
            OutboundEscalationStartedMessage: [resetTime], //think we need this
            OutboundArbitrationResultsMessage: [noFire], //MindSection render debug content
            OutboundAgentSessionChangedMessage: [resetTime],
            OutboundReplayFinishedMessage: [function(message, messageBody, conversation) {
            	conversation._pendingCancellableRequest = false;
				conversation._pendingFormOnlySubmission = false;
				conversation._inReplay = false;
				conversation._toggleInputState(true, 'OutboundReplayFinishedMessage');
                publicAmelia.fireEvent('conversationReplayEnd', conversation.publicConversation, chat.getConversationId(), {});
            }],
            OutboundAmeliaReadyMessage: [noFire], //also do not see used in conversation, only declared
            OutboundConversationClosedMessage: [resetTime, function(message, messageBody, conversation) {
				conversation._inReplay = false;
				conversation._pendingCancellableRequest = false;
				conversation._mode = null;
				conversation._inboundMessageType = null;
				conversation._pendingFormOnlySubmission = false;
				conversation.unsubscribe();
				conversation._contextId = null;

				delete chat._conversationsBySessionId[conversation._sessionId];
				if (chat._foreGroundSessionId === conversation._sessionId) {
					chat._foreGroundSessionId = null;
				}

                if (chat._pendingResetConversation !== undefined && chat._pendingResetConversation !== false) {
					chat._domainCode = conversation._domainCode;
                    chat._startWithDomain(chat._pendingResetConversation);
                    delete chat._pendingResetConversation;;
                }
            }],
			OutboundFqtCreatedMessage: [ resetTime ],
			//not in that but useful?
            OutboundAckRequestMessage: [noFire],
            OutboundBpnCompositionEventMessage: [], //V2 BpnCompositionEventProgressMessage
            OutboundBpnExecutionMessage: [],
            OutboundNewBpnExecutionEventMessage: [],
            OutboundRequestMessage: [ resetTime, uploadHandler ],
            OutboundPresentMessage: [ transformMultimedia, resetTime ],
            OutboundSessionClosedMessage: [function(message, messageBody, conversation) {
				conversation.unsubscribe();
				delete chat._conversationsBySessionId[conversation._conversationId];
				if (chat._foreGroundSessionId === conversation._sessionId) {
					chat._foreGroundSessionId = null;
				}
            }],
			OutboundSystemErrorMessage: [ resetTime ],
			//not in sessionsubscription, different topic
			//OutboundJoinConversationRequestMessage: [ ],
			OutboundConversationSuspendedMessage: [ resetTime ],
			OutboundRecommendationsMessage: [ resetTime ]
		}

		var subscriptionConfig = chat._buildSubscriptionConfig(chat._subscriptionConfig, additionalInternalParsers, internalHandlers, fireMessageQueueIfNeeded, onSubscribeCallback);

		subscriptionConfig.wsConnection = chat._wsConnection;
		subscriptionConfig.conversationId = conversation.conversationId;
		subscriptionConfig.sessionId = conversation.sessionId;

		chat._conversationsBySessionId[conversation.sessionId] = new AmeliaConversation({
			conversationId: conversation.conversationId,
			sessionId: conversation.sessionId,
			languageCode: conversation.languageCode,
			sessionMode: mode,
			subscription: new SessionSubscription(subscriptionConfig)
		})
	};

	// As of 3.7.17, We no longer serialize the attributes map from the backend.  The UI deeply relies on it, however,
	// so reconstruct an attributes map from top level properties excluding those that are/were not
	// attributes
	chat._baseProperties = [
		'messageText',
		'id',
		'contextId',
		'sourceClass',
		'translated',
		'messageType',
		'messageId',
		'voice',
		'inResponseToMessageId',
		'fromUserDisplayName',
		'conversationId',
		'sourceSessionId',
		'responsePoolContext'
	];

	chat._propertiesToRename = {
		'hint_text': 'hintText',
		'resource_to_request': 'resourceToRequest'
	};
    chat._buildSubscriptionConfig = function(subscriptionConfig, additionalInternalParsers, internalHandlers, fireMessageQueueIfNeeded, onSubscribeCallback) {
        var config =  {};
        for (var key in subscriptionConfig) {
            if (subscriptionConfig.hasOwnProperty(key)) {
                config[key] = subscriptionConfig[key];
            }
        }
		config.messageHandler =  function (message) {
        		//get the conversation from the message

				var conversation = chat._getConversationByMessage(message);

                var msgBody = JSON.parse(message.body);
				if (msgBody.attributes === undefined) {
					var reformedAtts = {};
					for (var key in msgBody) {
						if (msgBody.hasOwnProperty(key)) {
							if (chat._baseProperties.indexOf(key) === -1) {
								if (chat._propertiesToRename[key] === undefined) {
									reformedAtts[key] = msgBody[key];
								} else {
									reformedAtts[chat._propertiesToRename[key]] = msgBody[key];
								}
							}
						}
					}
					msgBody.attributes = reformedAtts;
					message.body = JSON.stringify(msgBody);
				}
                if (msgBody.contextId != undefined) {
					conversation._setContextId(msgBody.contextId);
				}
                if (additionalInternalParsers[msgBody.messageType]) {
                    additionalInternalParsers[msgBody.messageType].call(chat, message, msgBody, conversation);
                }

                conversation._checkInputStatus(msgBody, message.headers);
                conversation._checkEmotionalState(msgBody.attributes);

                if (msgBody.voice) {
                	conversation._setVoice(msgBody.voice);
					if (chat._isV4 === true) {
						var locale = msgBody.locale;
						if (locale && locale !== conversation._languageCode) {
							conversation.publicConversation.languageCode = locale;
							publicAmelia.fireEvent("languageChange", conversation.publicConversation, locale,
												   conversation._languageCode);
							conversation._languageCode = locale;
						}
					}
				}

                if (msgBody.fromUserDisplayName && 'false' === message.headers['X-Amelia-Self-Echo']) {
                    conversation._setConversationPartnerName(msgBody.fromUserDisplayName);
                }

                if (internalHandlers[msgBody.messageType]) {
                    for (var i=0;i<internalHandlers[msgBody.messageType].length;i++) {
                        if (internalHandlers[msgBody.messageType][i].call(chat, message, msgBody, conversation) === false) {
                            return;
                        }
                    }
                }

                if (chat._autoSpeak === true) {
					chat._playBml(msgBody, message.headers, conversation);
                }
                if (chat._messages.getLength() === 0) {
                    publicAmelia.fireEvent("messageReceived", conversation.publicConversation, message);
                    publicAmelia.fireEvent(msgBody.messageType, conversation.publicConversation, msgBody.messageType, msgBody,
                                           message.headers);
                } else {
                    chat._messages.enqueue({id:msgBody.id, msgBody:msgBody, message:message, conversation: conversation.publicConversation, ready:true});
                    fireMessageQueueIfNeeded();
                }
            };
        config.onSubscribeCallback = onSubscribeCallback;
        return config;
    }

	chat._disableAllSubscriptions = function() {
    	var toDelete = [];
    	for (var key in chat._conversationsBySessionId) {
			chat._conversationsBySessionId[key].unsubscribe()
			toDelete.push(key);
		}
		for (var i =0; i < toDelete.length;i++) {
			delete chat._conversationsBySessionId[toDelete[i]]
		}
		chat._foreGroundSessionId = null;
	}

	chat._disconnect = function() {
		if (chat._wsConnection && chat._wsConnection.connected) {
			chat._wsConnection.disconnect();
			delete chat._wsConnection;
		}
	}

	chat._loginSuccess = function(xhr) {
		if (xhr.getResponseHeader('x-amelia-session-auth')) {
			chat._ameliaSessionId = xhr.getResponseHeader('x-amelia-session-auth');
		}
        var result = JSON.parse(xhr.responseText);
        if (result.user) {
            delete chat._conversationsBySessionId;
            delete chat._foreGroundSessionId;
            chat._conversationsBySessionId = {};
            if (result.csrfToken) {
                chat._csrfToken = result.csrfToken;
            }
			if (!chat._wsConnection) {
				chat._wsConnection = new WebsocketConnection(chat._initialConfig);
				chat._wsConnection.connect(chat._csrfToken);
			}
			chat._setUser(result.user);
			publicAmelia.fireEvent("userInit", chat._user);
            publicAmelia.fireEvent("loginSuccess", "success", result.user, { expirationDate: result.expirationDate, expirationWarning: result.expirationWarning});
			chat._fetchDomains(function (dxhr) {
				// after a successful login, we can join a default conversation domain, but not rejoin a conversation, as that
				// can only occur if we arrive on the page already logged in
				try {
					var dArr = chat._setDomains(JSON.parse(dxhr.responseText).content);
					publicAmelia.fireEvent("domainFetch", dArr);
					if (chat._canJoinDefaultDomain === true && chat._user
						&& chat._user.defaultConversationDomainId !== undefined) {
						var defaultDomain = chat._domainsById[chat._user.defaultConversationDomainId];
						if (defaultDomain) {
							if (chat._hasDomainBeenSet !== true) {
								chat.setDomainCode(defaultDomain.code);
								chat._startWithDomain();
								return;
							}
						}
					}
					publicAmelia.fireEvent('appReady');
				} catch (err) {
					//console.error(err);
					publicAmelia.fireEvent("domainFetch", []);
					publicAmelia.fireEvent('appReady');
				}
			}, function() {
				publicAmelia.fireEvent("domainFetch", []);
				publicAmelia.fireEvent('appReady');
			});
        } else {
            publicAmelia.fireEvent("loginFail", "failure", result);
			publicAmelia.fireEvent('appReady');
		}
    }

    chat._loginFailure = function(xhr) {
        try {
            var result = JSON.parse(xhr.responseText);
            publicAmelia.fireEvent("loginFail", "error", result);
        } catch (err) {
            publicAmelia.fireEvent("loginFail", "error", {code: 'UNKNOWN_ERROR', statusText:xhr.statusText});
        }
    };


    /**
	 * attempts to log in a user
	 *
     * @param options and object containing a type, and parameters appropriate to its type
     */
	chat.login = function(options) {
		if (options === null || options === undefined) {
			publicAmelia.fireEvent("loginFail", "MISSING_OPTIONS");
			return;
		}
		//on a login attempt, disable input and all subscriptions immediately
		publicAmelia.fireEvent("inputDisabled", {}, "loginAttempt", {loginAttempt:true});
        chat._hasDomainBeenSet = false;
        chat._disableAllSubscriptions();
		chat._disconnect();
		//backwards compatibility
		if (options.type === 'INTERNAL') {
			options.redirect = false;
			if (options.loginPath === undefined) {
				options.loginPath = '/Amelia/api/login';
			}
		}

		var fixPath = function(options) {
            if (!options.loginPath.startsWith('/Amelia/')) {
                if (options.loginPath.startsWith('/')) {
                    options.loginPath = '/Amelia' + options.loginPath;
                } else if (options.loginPath.startsWith('#')) {
                    options.loginPath = window.location.href + options.loginPath;
                } else {
                    options.loginPath = '/Amelia/' + options.loginPath;
                }
            }
		}
		if (options.redirect === true) {
			if (options.loginPath === undefined) {
                publicAmelia.fireEvent("loginFail", "MISSING_REDIRECT_PATH", "redirect without loginPath provided");
				return;
            }
            fixPath(options);
            window.location.href=options.loginPath;
		} else {
            if (options.loginPath === undefined) {
                options.loginPath = '/Amelia/api/login';
            } else {
                fixPath(options);
            }

            postJson(options.loginPath, chat._sessionHeaders({}), undefined,
                     JSON.stringify({username: options.username, password: options.password}),
                     function () {
                     },
                     undefined,
                     chat._loginSuccess,
                     chat._loginFailure);
        }
    };

    /**
	 * logs out from Amelia only -- third party authentication providers will have to logout using their own mechanisms
     */
	chat.logout = function() {
        publicAmelia.fireEvent("inputDisabled", {}, "logout", {logout:true});
        chat._disableAllSubscriptions();
        getJson('/Amelia/api/logout', chat._sessionHeaders({}),
                 function() { },
                undefined,
                 function(xhr) {
                     chat._csrfToken = null;
                     chat._setUser(undefined);
                     chat._appConfig = undefined;
                     chat._data = undefined;
                     _needingInit = true;
                     publicAmelia.fireEvent("logout", "logout");
                 },
                 function(xhr) {
                     chat._csrfToken = null;
                     chat._setUser(undefined);
                     chat._appConfig = undefined;
                     chat._data = undefined;
                     _needingInit = true;
                     publicAmelia.fireEvent("logout", "logout");

                 }
		);
	};

	chat.getConversations = function() {
	    var conversations = {};
	    for (var sessionId in chat._conversationsBySessionId) {
	    	var conv = chat._conversationsBySessionId[sessionId];
	    	conversations[sessionId] = conv.publicConversation;
		}
		return conversations;
    }

	chat.switchConversation = function(sessionId) {
		if (sessionId !== chat._foreGroundSessionId) {
			if (chat._conversationsBySessionId[sessionId]) {
				chat._setConversationId(chat._conversationsBySessionId[sessionId].conversationId);
				chat._setContextId(chat._conversationsBySessionId[sessionId].contextId);
				chat._setSessionId(sessionId);
				publicAmelia.fireEvent('conversationSwitch', chat._conversationsBySessionId[sessionId].publicConversation);
			} else {
				publicAmelia.fireEvent('ErrorNoSuchConversation', sessionId);
			}
		}
	}
	/**
	 * Toggle the "offTheRecord" status of this conversation's next input.  Will have no effect if the server has
	 * declared the next input must be off the record.  Will fire an offTheRecord/onTheRecord event if successfully
	 * changed.
	 * @param newValue true if the next input should be off the record, false otherwise
	 * @param sessionId optional, the conversation session to which this should apply; will attempt the fore ground
	 * conversation if omitted.
	 */
	chat.toggleOffTheRecord = function(newValue, sessionId) {
		var conversation = chat._getConversationBySessionId(sessionId);
		if (conversation._empty === true) {
			publicAmelia.fireEvent('ErrorNoSuchConversation', sessionId);
		} else {
			conversation._toggleOffTheRecordState({ offTheRecordResponse: newValue }, "clientpreference", false, {});
		}
	}

	/**
	 * Send a user text message to amelia and updates the chat's timeOfLastMessage
	 * @param text {string} the text to send to Amelia
	 * @param sessionId {string} the sessionId of a conversation where to send this message.  Will attempt to use the foreground
	 * conversation if undefined
     * @param attributes {object} attributes to send along with the text
	 */
	chat.ask = function(text, sessionId, attributes) {
		var conversation = chat._getConversationBySessionId(sessionId);
		if (conversation._empty === true) {
			publicAmelia.fireEvent('ErrorNoSuchConversation', sessionId);
			return;
		}
		var obj = attributes || {};
		obj.messageText = text;
		if (conversation._inputSecure === true) {
			obj.secure = 'yes'
		}
		conversation._sendMessageToServer(obj, conversation._inboundMessageType);
		conversation._timeOfLastMessage = new Date().getTime();
	}

	/**
	 * Send a user activity message to amelia and updates the chat's timeOfLastMessage.  Will only send a message if the activity
	 * state of the conversation has changed.
	 * @param typing {boolean} true to send the start of activity, false to send its end
	 * @param sessionId {string} the sessionId of a conversation where to send this message.  Will attempt to use the foreground
	 * conversation if undefined
	 * @param attributes {object} attributes to send along with the activity message
	 */
	chat.sendActivity = function(typing, sessionId, attributes) {
		var conversation = chat._getConversationBySessionId(sessionId);
		if (conversation._empty === true) {
			publicAmelia.fireEvent('ErrorNoSuchConversation', sessionId);
			return;
		}
		if (conversation._typing !== typing) {
			var obj = attributes || {};
			obj.typing = typing;
			conversation._sendMessageToServer(obj, 'InboundUserActivityMessage');
			conversation._timeOfLastMessage = new Date().getTime();
			conversation._typing = typing;
		}

	}

	/**
	 * alias for ask
	 */
	chat.say = chat.ask;

	chat.changeLanguage = function(language, direction, sessionId) {

		if (chat._multipleConversationMode === true) {
			var conv = chat._conversationsBySessionId[sessionId];
			if (conv) {
				conv.changeLanguage(language, direction);
			}
		} else {
			if (chat._getForegroundConversation() !== null && chat._getForegroundConversation() !== undefined) {
				chat._getForegroundConversation().changeLanguage(language, direction);
			}
		}
	};

	/**
	 * send resume process message to server
	 */
	chat.resumeProcess = function(sessionId, data) {
		var conversation = chat._getConversationBySessionId(sessionId);
		if (conversation._empty === true) {
			publicAmelia.fireEvent('ErrorNoSuchConversation', sessionId);
			return;
		}
		conversation._sendMessageToServer(data || null, "InboundProcessResumeMessage");
		conversation._timeOfLastMessage = new Date().getTime();
	}

    /**
	 * sends conversation attributes
	 * @param attributes a set of key/value pairs to set on a conversation
     */
    chat.sendCustomConversationAttributes = function(attributes, sessionId) {
		var conversation = chat._getConversationBySessionId(sessionId);
		if (conversation._empty === true) {
			publicAmelia.fireEvent('ErrorNoSuchConversation', sessionId);
			return;
		}
    	if (attributes !== undefined && attributes !== null) {
			conversation._sendMessageToServer({customAttributes: attributes}, "InboundSetCustomConversationAttributesMessage");
			conversation._timeOfLastMessage = new Date().getTime();
        }
	}

	chat.transfer = function(attributes, sessionId) {
		var conversation = chat._getConversationBySessionId(sessionId);
		if (conversation._empty === true) {
			publicAmelia.fireEvent('ErrorNoSuchConversation', sessionId);
			return;
		}
		if (attributes !== undefined && attributes !== null) {
			conversation._sendMessageToServer({escalationQueueId: attributes.escalationQueueId}, "InboundAgentTransferMessage");
			conversation._timeOfLastMessage = new Date().getTime();
			conversation.disconnectConversation();
		}
	}

	/**
	 * submits a form
	 *
	 * @param form - either an html form containing all widgets or a JSON object to submit
	 * @param formInputData
	 * @param sessionId the sessionId of the conversation to use.  If undefined, the foreground conversation will be used
     * @param message - optional, the text to speak in the submission.  if omitted, the formInputData will build speech
	 * @param options - optional, other attributes to put in the submission
	 */
	chat.submit = function(form, formInputData, sessionId, message, options) {
		var conversation = chat._getConversationBySessionId(sessionId);
		if (conversation._empty === true) {
			publicAmelia.fireEvent('ErrorNoSuchConversation', sessionId);
			return;
		}
        var sentences = {};
        //utterance metadata; used to formulate responses
        var utterances = {};

        var findMsgForValue= function(name, value) {
            if (formInputData === null || formInputData === undefined) {
                return undefined;
            }
            for (var i = 0;i<formInputData.fields.length;i++) {
                if (formInputData.fields[i].name === name) {
                    for (var j = 0; j < formInputData.fields[i].options.length; j++) {
                        if (formInputData.fields[i].options[j].value === value) {
                            utterances[name] = formInputData.fields[i].selectionUtteranceMetadata;
                            return formInputData.fields[i].options[j].name;
                        }
                    }
                }
            }
            return undefined;
        }

        var setMsgForValue = function(name, value) {
            if (value) {
                if (sentences[name]) {
                    sentences[name].push(value);
                } else {
                    sentences[name] = [value];
                }
            }
        }

		if (form instanceof Element) {
			//works in IE9 standards mode -- need to support quirksmode?
			var fields = form.querySelectorAll('input, select, textarea'),
				toSubmit = {};

			for (var i = 0, imax = fields.length; i < imax; ++i) {
				var field = fields[i],
					sKey = field.name || field.id;

				if (field.type === 'button' || field.type === 'image' || field.type === 'submit' || !sKey) continue;
				switch (field.type) {
					case 'checkbox':
						if (field.checked) {
							if (toSubmit[sKey] === undefined) {
								toSubmit[sKey] = field.value;
							} else {
								var old = toSubmit[sKey];
								toSubmit[sKey] = [old];
								toSubmit[sKey].push(field.value);
							}
							setMsgForValue(sKey, findMsgForValue(sKey, field.value));
						}
						break;
					case 'radio':
						if (toSubmit[sKey] === undefined) toSubmit[sKey] = '';
						if (field.checked) {
							toSubmit[sKey] = field.value;
							sentences[sKey] = findMsgForValue(sKey, field.value);
						}
						break;
					case 'select-multiple':
						var a = [];
						for (var j = 0, jmax = field.options.length; j < jmax; ++j) {
							if (field.options[j].selected) a.push(field.options[j].value);
							setMsgForValue(sKey, findMsgForValue(sKey, field.options[j].value));
						}
						toSubmit[sKey] = a;
						break;
					default:
						toSubmit[sKey] = field.value;
						sentences[sKey] = findMsgForValue(sKey, field.value);
				}
			}
		} else {
			toSubmit = form;
			for (var sKey in toSubmit) {
				if (toSubmit.hasOwnProperty(sKey)) {
					var v = toSubmit[sKey];
					if (isArray(v)) {
						for (var i=0;i<v.length;i++) {
                            setMsgForValue(sKey, findMsgForValue(sKey, v[i]));
                        }
					} else {
						sentences[sKey] = findMsgForValue(sKey, v);
					}
				}
			}
		}

		var text;
		if (message) {
		    text = message;
        } else {
		    text = '';
            var msg = function(selections, md) {
                var t = '';
                for (var i=0;i<selections.length;i++) {
                    t += selections[i];
                    if (i === selections.length-1) {

                    } else if (i === selections.length-2) {
                        t += ' ' + md.conjunction + ' ';
                    } else {
                        t+= ', ';
                    }
                }
                return t;
            }

            var topMd;
            if (formInputData) {
            	topMd = formInputData.selectionUtteranceMetadata || { conjuction: ' '};
            } else {
            	topMd = { conjuction: ' '}
			}
            var topConj = ' ' + topMd.conjunction + ' ' || ' ';
            for (var o in sentences) {
                if (sentences.hasOwnProperty(o)) {
                    var s = sentences[o];
                    if (s) {
                        var md = utterances[o];
                        if (isArray(s)) {
                            switch (s.length) {
                                case 0:
                                    text += 'Nothing';
                                    break;
                                case 1:
                                    if (md) {
                                        text += md.prefixSingle + ' ' + msg(s, md);
                                    }
                                    break;
                                default:
                                    if (md) {
                                        text += md.prefixMultiple + ' ' + msg(s, md);
                                    }
                            }
                        } else {
                            if (md) {
                                text += md.prefixSingle + ' ' + s
                            }
                        }
                        text += topConj;
                    }
                }
            }
            if (text === '') {
                text = 'I have submitted'
            } else {
            	// since we added the conjunction, trim it off if that is the end
				if (topConj) {
					var len = topConj.length;
                    if (text.substring(text.length-len) === topConj) {
                        text = text.substring(0, text.length-len);
                    }
                    if (topMd.prefixSingle) {
                        text = topMd.prefixSingle + ' ' + text;
                    }
                    if (topMd.suffixSingle) {
                        text = topMd.suffixSingle;
                    }
                }

			}
        }
        // Temporary workaround as some uiux forms submit a string, not an object, which is not allowed.  To be removed when UIUX code changed in all instances
		if (typeof toSubmit === 'string') {
			try {
				toSubmit = JSON.parse(toSubmit);
			} catch (err) {
				//console.error('unable to parse toSubmit value');
			}
		}

		conversation._pendingFormOnlySubmission = false;
        conversation._toggleInputState(true, 'FormSubmit', { formSubmit:true});
        var attributes = { formInputAttributes: toSubmit };
        if (options) {
        	applyIf(attributes, options);
		}
		conversation._sendMessageToServer({ messageText: text, attributes: attributes}, conversation._inboundMessageType);
	};

    /**
	 * Submit an integration action to Amelia, which will run a named bpn with the provided arguments, along with either
	 *    a static message defined in SubmissionUtteranceMetadata or a custom message provided to the method
	 *
     * @param processName - the name of the BPN process to run
     * @param processArgs - the arguments to pass to that BPN process
	 * @param sessionId
     * @param submissionMetadata - a SubmissionUtteranceMetadata object, with a staticUtterance property.  Can come from
	 *         BPN naturally, but only the staticUtterance is supported { staticUtterance: "Please run this"}
     * @param message a custom message to send.  If present, overrides anything in the submissionMetadata
     */
	chat.action = function(processName, processArgs, sessionId, submissionMetadata, message) {
		var conversation = chat._getConversationBySessionId(sessionId);
		if (conversation._empty === true) {
			publicAmelia.fireEvent('ErrorNoSuchConversation', sessionId);
			return;
		}
		conversation._pendingFormOnlySubmission = false;
		conversation._toggleInputState(true, 'ActionSubmit', { actionSubmit:true});
        var text;
		var shouldEcho = true;
        if (message) {
        	text = message;
		} else {
			if (submissionMetadata) {
				if (submissionMetadata.staticUtterance) {
					text = submissionMetadata.staticUtterance;
				}
			}
        }

		if (submissionMetadata && submissionMetadata.shouldEcho === false) {
			shouldEcho = false;
		}


        if (text === undefined || text === null) {
            text = "BPN Kickoff Message";
		}
		conversation._sendMessageToServer({ messageText: text, attributes: {
        	processName:processName,
			processVariables: processArgs
			}, shouldEcho: shouldEcho},  "InboundBpnKickoffMessage");

	}

	chat.createFqt = function(attributes) {
		chat._sendMessageToServer({ attributes: attributes || {} }, "InboundCreateFqtMessage");
	}

	/**
	 * ends a conversation
	 */
	chat.endConversation = function(attributes, sessionId) {
		var conv;
		if (chat._multipleConversationMode === true) {
			conv = chat._conversationsBySessionId[sessionId];
		} else {
			conv = chat._getForegroundConversation();
		}
		if (conv !== null && conv !== undefined && conv._empty !== true) {
			conv._sendMessageToServer(attributes === undefined ? null : {attributes: attributes},
									  "InboundConversationClosedMessage");
		} else {
			publicAmelia.fireEvent('ErrorNoSuchConversation', sessionId);
		}
	}

	chat.disconnectConversation = function(sessionId) {
		var conv = chat._conversationsBySessionId[sessionId];
		if (conv) {
			chat._conversationsBySessionId[sessionId].unsubscribe();
			delete chat._conversationsBySessionId[sessionId];
			if (chat._foreGroundSessionId === sessionId) {
				chat._foreGroundSessionId = null;
			}
		}
	}

	chat.getConversationPartnerName=function(sessionId) {
		return chat._getConversationBySessionId(sessionId)._conversationPartnerName;
	}

	/**
	 * Sends a message to the Amelia server
	 * @param messageBody {string} the text body of the message
	 * @param messageType {string} the type of the message to send
	 * @private
	 */
	chat._sendMessageToServer =function(messageBody, messageType) {
		chat._getForegroundConversation()._sendMessageToServer(messageBody, messageType);
	};

	/**
	 * clear the chat history -- since AmeliaChat does not maintain a client side history, this has no effect internally, but
	 * fires an event that other components can listen to and react
	 * @event chatHistoryClear
	 * @deprecated
	 */
	chat.clearChatHistory = function(){
		publicAmelia.fireEvent("chatHistoryClear");
	};

	/**
	 * A hash of the listeners for events
	 * @type {{}}
	 * @private
	 */
	var listeners = {};

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
	chat.addEventListener = function(event, recipient, fn) {
		if (listeners[event] === undefined) {
			listeners[event] = [];
		}
		listeners[event].push(fn.bind(recipient));
	};

	/**
	 * Add multiple listeners to the chat
	 * @param - many types, see separate docs
	 */
	chat.addEventListeners = function() {
		if (arguments.length === 0) return;
		//if the first one is a string, assume they are using the single format
		if (typeof arguments[0] === 'string') {
			chat.addEventListener.apply(chat, arguments);
		}
		//otherwise, assume its one config element hash
		var eventConfig = arguments[0];
		if (eventConfig) {
			for (var event in eventConfig) {
				if (eventConfig.hasOwnProperty(event)) {
					var value = eventConfig[event]	;
					if (!isArray(value)) {
						value = [value];
					}
					for (var i=0;i<value.length;i++) {
						var a = value[i];
						switch (typeof a) {
							case 'function':
								chat.addEventListener(event, publicAmelia, a);
								break;
							case 'object':
								if (a !== null && typeof a['fn'] === 'function') {
									chat.addEventListener(event, a['element'] === undefined ? publicAmelia : a['element'], a['fn'])
								}
						}
					}
				}
			}
		}
	}

	chat.addEventListeners(config.listeners);
	chat.addEventListener("loginSuccess", window, function() {
		//reset state that may prevent a conversation from starting
        chat._inReplay = false;
        chat._pendingCancellableRequest = false;
        chat._pendingFormOnlySubmission = false;
        chat._setConversationId(null);
		chat._setContextId(null);
        chat._pendingResetConversation = false;
    });

	/**
	 * A hash to hold the status of each event firing, so that if a listener invokes a chain that fires the very event it listens
	 * to, the chain will break rather than go into an infinite loop
	 * @type {{}}
	 * @private
	 */
	chat._eventLock = {};

	/**
	 * fires an event, with the AmeliaChat instance as the first argument, and 2...n arguments to this function
	 * as the arguments in the fired event
	 * @param event {string} the name of the event to fire
	 */
	chat.fireEvent = function(event) {
		if (chat._eventLock[event] !== true) {
			chat._eventLock[event] = true;
			if (listeners[event] !== undefined) {
				var newArgs = [publicAmelia];
				if (arguments.length > 1) {
					for (var i=1;i<arguments.length;i++) {
						newArgs.push(arguments[i]);
					}
				}

				for (var i=0;i<listeners[event].length;i++) {
					listeners[event][i].apply(undefined, newArgs);
				}
			}
			chat._eventLock[event] = false;
		} else {
			console.error("Circular event listening detected for event: " + event
						  +".  Listeners must not fire the same event to which they are listening.  Application will continue"
						  + " but this event chain will be stopped.");
		}
	}

	chat._terminateSounds = function() {
        if (chat._spokenQueues) {
        	chat._spokenQueues = {};
        }
        if (chat._audioQueues) {
            chat._audioQueues = {};
		}
		if (chat._audioMaps) {
            chat._audioMaps = {};
		}
        if (chat._currentSound) {
            chat._currentSound.unload();
        }
	}

	//a map of text to URLs so we can speak only when it has arrived
	chat._audioMap = {};

	/**
	 * Any custom implementation of TTS *must* include this somewhere in their fetchSpeech implementation, as without it it will
	 * not queue audio for playback in the SDK.  Does nothing if config.speech is false.
	 * @param tts the tts object from the SDK used to fetch the speech.  Important to pass back unchanged.
	 * @param data the audio data to be queued.  Format is up to the implementation, as long as the fetchSpeech and playSpeech
	 * 			methods both agree on the data format
	 */
	chat.addFetchedAudio = function(tts, data) {
		if (config.speech) {
			if (!chat._audioMaps[tts.sessionid]) {
				chat._audioMaps[tts.sessionId] = {};
			}
			chat._audioMaps[tts.sessionId][tts.text] = data;
		}
	}

	/**
	 * A public facing method so custom speech implementations can trigger the standard SDK events.  Calling this when audio
	 * starts to play will force the SDK to fire the 'speakstart' event, so the rest of an application can respond to the
	 * beginning of speech regardless of TTS implementation.
	 */
	chat.onFetchedAudioPlayStart = function() {
		publicAmelia.fireEvent('speakstart');
	}

	/**
	 * A public facing method so custom speech implementations can trigger the standard SDK events.  Calling this when audio
	 * finishes playing (e.g. in the onend callback that most audio services provide) will force the SDK to do its internal
	 * housekeeping *and* fire the 'speakend' event, so the rest of an application can respond to the end of speech
	 * regardless of TTS implementation/
	 */
	chat.onFetchedAudioPlayEnd = function() {
		if (chat._audio) {
			chat._audio.playing = false;
		}
		publicAmelia.fireEvent('speakend');
		chat._currentSound = undefined;
	}

	if (config.speech) {
		var speechParams;
		if (config.speech === true) {
			speechParams = {
				muted:false,
				auto:true
			}
		} else {
			speechParams = config.speech;
			speechParams.auto = speechParams.auto === false ? false : true;
		}
        //a map of sessionid to queue of text to generate audio
		chat._spokenQueues = {};
        //a map of sessionid to queue to hold the text and the pending urls to preserve order
        chat._audioQueues = {};

        //a map of sessionId to hold audio to speak
		chat._audioMaps = {};

        chat._muted = speechParams.muted === true;
        chat._autoSpeak = speechParams.auto === true;


        if (Howler) {
			var codecs = Howler.codecs || Howler.Howler.codecs;
			var useMp3 = false;
			try {
				useMp3 = codecs('wav') !== true && codecs('mp3') === true;
			} catch (err) {
				console.debug('cannot transcode to mp3, codecs not present', err);
			}
			/** Howler internally tries this, but it does not work on iOS **/
            var ctx = null, usingWebAudio = true;
            try {
                if (typeof AudioContext !== 'undefined') {
                    ctx = new AudioContext();
                } else if (typeof webkitAudioContext !== 'undefined') {
                    ctx = new webkitAudioContext();
                } else {
                    usingWebAudio = false;
                }
            } catch(e) {
                usingWebAudio = false;
            }

            // context state at this time is `undefined` in iOS8 Safari
            if (usingWebAudio && ctx.state === 'suspended') {
                var resume = function () {
                    ctx.resume();

                    setTimeout(function () {
                        if (ctx.state === 'running') {
                            document.body.removeEventListener('touchend', resume, false);
                        }
                    }, 0);
                };

                document.body.addEventListener('touchend', resume, false);
            }

			//In webpack environments, Howler global is exported as an object under Howler
			var howlerGlobal = Howler.Howler || Howler;
			chat._audio = {
				playing:false,
				volume:function(level) {
					howlerGlobal.volume(level);
				}
			};

			// establish a fetchSpeech implemntation; if none provided, use the SDK/Amelia internal default
            chat._fetchSpeech = config.fetchSpeech || function(tts, chat) {

				var params = {text: tts.text, voice: tts.voice === undefined ? chat._getVoice() : tts.voice, conversationId: tts.conversationId};
				postJson('/Amelia/api/speech/generate',
						 chat._sessionHeaders({'Content-Type': 'application/json'}), undefined,
						 JSON.stringify(params),
						 function () {
						 },
						 undefined,
						 function (xhr) {
							 var data = JSON.parse(xhr.responseText);
							 if (data && data.audio) {
							 	chat.addFetchedAudio(tts, data);
							 } else {
								chat.addFetchedAudio(tts, '');
							 }
						 },
						 function (xhr) {
							 chat.addFetchedAudio(tts, '');
							 //console.log("Unable to fetch audio");
							 //console.log(xhr);
						 }
				);
			}

			// establish a playSpeech implemntation; if none provided, use the SDK/Amelia internal default
			chat._playSpeech = config.playSpeech || function(toPlay, publicAmelia) {
				if (useMp3 === true) {
					toPlay.audio = toPlay.audio.replace(".wav", ".mp3")
				}
				chat._currentSound = new Howl({
					  src: [toPlay.audio],
					  autoplay: true,
					  onplay: function() {
						publicAmelia.onFetchedAudioPlayStart();
					  },
					  onend: function() {
					  	this.unload();
					  	publicAmelia.onFetchedAudioPlayEnd();
					  }
				  });
			}

            setInterval(function () {
            	var fgid = chat._foreGroundSessionId;
            	if (fgid !== null) {
					if (chat._spokenQueues[fgid]) {
						var tts = chat._spokenQueues[fgid].dequeue();
						if (!chat._audioQueues[fgid]) {
							chat._audioQueues[fgid] = new Queue();
						}
						if (tts !== undefined && tts.text !== undefined) {
							if (chat._muted === false) {
								chat._audioQueues[fgid].enqueue(tts);
								if (!chat._audioMaps[fgid]) {
									chat._audioMaps[fgid] = {};
								}
								chat._audioMaps[fgid][tts.text] = null;
								chat._fetchSpeech(tts, chat);
							}
						}

						if (chat._audio.playing === false) {
							var toPlay;
							var dtoPlay = chat._audioQueues[fgid].peek();
							if (dtoPlay !== undefined && chat._audioMaps[fgid][dtoPlay.text] !== null) {
								dtoPlay = chat._audioQueues[fgid].dequeue();
								toPlay = chat._audioMaps[fgid][dtoPlay.text];
								delete chat._audioMaps[fgid][dtoPlay.text];

							}

							if (toPlay !== undefined && toPlay.audio !== undefined && chat._muted === false) {
								chat._audio.playing = true;
								chat._playSpeech(toPlay, publicAmelia);
							}
						}
					}
				}
            }, 1000);
        }
    }
	var bmlCleaners = [
        new RegExp('<nospeak>.*?</nospeak>', 'gi'),
        new RegExp('_Syncword\\d+_', 'gi')
	];

	chat._extractTextV3 = function(msgBody, headers, conversation) {
		if (chat._audio !== undefined) {
			if (msgBody.attributes.bml) {
				var bml = JSON.parse(msgBody.attributes.bml);
				for (var i = 0; i < bml.length; i++) {
					for (var j = 0; j < bml[i].length; j++) {
						var current = JSON.parse(bml[i][j]);
						for (var key in current) {
							if (current.hasOwnProperty(key) && key.indexOf("Speech") === 0) {
								var text = current[key].text;
								//do not speak if mmo response; deprecated but for safety
								if (text.indexOf('amelia-mmo') === -1) {
									for (var c = 0; c < bmlCleaners.length; c++) {
										text = text.replace(bmlCleaners[c], '');
									}
									chat._speak(text, conversation._voice, conversation._sessionId, conversation._conversationId);
								}
							}
						}
					}
				}
			}
		} else {
			//log it or fire an event?
		}
	}

	chat._extractTextV4 = function(msgBody, headers, conversation) {
		var userType = headers['X-Amelia-Source-User-Type'];
		if (msgBody.messageText && msgBody.messageType === 'OutboundTextMessage' && userType === 'Amelia') {
			chat._speak(msgBody.messageText, conversation._voice, conversation._sessionId, conversation._conversationId);
		}
	}

	/**
	 * speak text -- the actual function can be re-chosen on /init based on the appConfig
	 * @param text the plain text to speak
	 * @see initSession
	 */
	chat._playBml = chat._extractTextV4;

    chat.getUploadHeaders = function() {
        return {
            Accept: "application/json, text/plain, */*",
            "X-CSRF-TOKEN": chat._csrfToken
        };
	};

    chat.getUploadUrl = function() {
        return '/Amelia/api/cm/upload';
    };

	/**
	 * Confirm an upload.
	 * @param fileUploadSuccessMessage a text message to send to a BPN
	 * @param json the json response in the case of an unsolicted response
	 * @param unsolicited true if unsolicted, false if from a BPN request
	 */
	chat.confirmUpload = function(fileUploadSuccessMessage, json, unsolicited, sessionId) {
		var conversation = chat._getConversationBySessionId(sessionId);
		if (conversation._empty === true) {
			publicAmelia.fireEvent('ErrorNoSuchConversation', sessionId);
			return;
		}
		if (unsolicited === true) {
			conversation._sendMessageToServer({
			   attributes: { cm_object_metadata_id: json.cmMetadataId }
		   },
		   'InboundUnsolicitedUploadMessage');
		} else {
			conversation._sendMessageToServer({
			   messageText: fileUploadSuccessMessage,
			   attributes: {"request_confirmation_action": "SUBMIT"}
		   },
		   'InboundRequestConfirmMessage');
		}
		conversation._pendingCancellableRequest = false;
		conversation._timeOfLastMessage = new Date().getTime();
	};

    /**
     * cancels an request, typically an upload request
     * @param options - a hash of options.  Currently unused
     */
    chat.cancelRequest = function(options, sessionId) {
    	//console.error("need to fix cancelRequest")
		var conversation = chat._getConversationBySessionId(sessionId);
		if (conversation._empty === true) {
			publicAmelia.fireEvent('ErrorNoSuchConversation', sessionId);
			return;
		}
		if (conversation._pendingCancellableRequest === true) {
            //done here to bypass input disabled checks
			conversation._sendMessageToServer({
				   messageText: 'File upload cancelled.',
				   attributes:{"request_confirmation_action":"CANCEL"}
			   }, 'InboundRequestConfirmMessage');
		publicAmelia.fireEvent("uploadCancelled", conversation);
			conversation._pendingCancellableRequest = false;
        } else {
            publicAmelia.fireEvent("ErrorNoCancellableRequest");
        }
    }

	/**
	 * @params feedback - positive 1 for 'thumbs up', negative 1 (-1) for 'thumbs down'
	 * @params outboundMessageId - message id for which feedback is sent
	 * @params answerId - answerId id within messageId for which feedback is sent
	 * @params feedbackText - text of the feedback
	 * */
	chat.sendNpsCollection = function(feedback, outboundMessageId, answerId, feedbackText) {
		var params = { feedback: feedback };
		if (outboundMessageId) {
			params.outboundMessageId = outboundMessageId;
		}
		if (answerId) {
			params.answerId = answerId;
		}
		if (feedbackText) {
			params.feedbackText = feedbackText;
		}
		chat._sendMessageToServer(params, "InboundNpsCollectionMessage");
	}

	/**
	 * @params messageId {string} - message id for which details is clicked
	 * @params answerId {string} - answerId within messageId for which details is clicked
	 * */
	chat.sendInboundDetailClickMessage = function(messageId, answerId) {
		chat._sendMessageToServer({ outboundMessageId: messageId, answerId: answerId || "" }, "InboundDetailClickMessage");
	}

	chat._speak=function(text, voice, sessionId, conversationId) {
        if (chat._audio !== undefined) {
        	if (!chat._spokenQueues[sessionId]) {
        		chat._spokenQueues[sessionId] = new Queue();
			}
        	chat._spokenQueues[sessionId].enqueue({text:text, voice:voice, sessionId: sessionId, conversationId: conversationId});
        }
	}

	chat.mute=function(text) {
        if (chat._audio) {
			chat._muted = true;
            chat._audio.volume(0);
        }
        publicAmelia.fireEvent('volumechange', 0);
	}

	chat.unmute=function(text) {
		if (chat._audio) {
			chat._muted = false;
            try {
            	chat._audio.volume(1);
            } catch (err) {
            	//if you unmute without playing first, audio5js throws an error
			}
        }
		publicAmelia.fireEvent('volumechange', 1);
	}

	/**
	 * Send the mictextready event, indicating that the stt engine has been initialized
	 * @param arg {object} any object that should be passed as the second argument with the event.
	 */
	chat.sttMicReady = function(arg) {
		publicAmelia.fireEvent('micready', arg);
	}

	/**
	 * Send the micfail event, indicating that the stt engine cannot be initialized
	 * @param arg {object} any object that should be passed as the second argument with the event.
	 * @param msg {string} a message about the failure
	 */
	chat.sttMicFail = function(arg, msg) {
		publicAmelia.fireEvent('micfail', arg, msg);
	}

	/**
	 * Send the micrecordingstart event, indicating that the stt engine has begun recording sound
	 * @param arg {object} any object that should be passed as the second argument with the event.
	 */
	chat.sttMicRecordingStart = function(arg) {
		publicAmelia.fireEvent('micrecordingstart', arg);
	}

	/**
	 * Send the mictextinterim event, indicating that the stt engine has returned a partial transcription, though has not yet
	 * completed recording
	 * @param arg {object} any object that should be passed as the second argument with the event.
	 * @param resultText {string} the transcribed text
	 */
	chat.sttMicTextInterim = function(arg, resultText) {
		publicAmelia.fireEvent('mictextinterim', arg, resultText);
	}


	/**
	 * Send the mictextinterim event, indicating that the stt engine has returned a partial transcription, though has not yet
	 * completed recording
	 * @param arg {object} any object that should be passed as the second argument with the event.
	 * @param resultText {string} the transcribed text
	 */
	chat.sttMicTextFinish = function(arg, resultText) {
		publicAmelia.fireEvent('mictextfinish', arg, resultText);
	}

	/**
	 * Send the micrecordingend event, indicating that the stt engine has finished recording sound
	 * @param arg {object} any object that should be passed as the second argument with the event.
	 */
	chat.sttMicRecordingEnd = function(arg) {
		publicAmelia.fireEvent('micrecordingend', arg);
	}

	/**
	 * Send the micnomatch event, indicating that the stt engine was unable to come up with meanngful transcription
	 * @param arg {object} any object that should be passed as the second argument with the event.
	 */
	chat.sttMicNoMatch = function(arg) {
		publicAmelia.fireEvent('micnomatch', arg);
	}

    //FR
    chat._convertImage = function(image, options) {
        var options = options || {};
        options.imageData = image.replace(/^data:image\/(png|jpeg);base64,/, '');
        return JSON.stringify(options);
    }

    chat.detectFace = function(imageFn, options) {
        var count = 0;
        var lastSuccessfullImage;
        var detectIt = function() {
            var image = imageFn();
            chat._initSession(function() {
                options = options || {};
                var success = options && options.success || undefined;
                var failure = options && options.failure || undefined;

                postJson('/Amelia/api/facereco/detect',
                         chat._sessionHeaders({'X-Requested-With': 'XMLHttpRequest', 'Content-Type': 'application/json'}),
                         undefined, chat._convertImage(image),
                         function() { },
                         undefined,
                         function(xhr) {
                             var data = JSON.parse(xhr.responseText);
                             if (data.success === true) {
                                 lastSuccessfullImage = image;
                                 if ('function' === typeof success) {
                                     success(publicAmelia, data, lastSuccessfullImage, xhr.status);
                                 }
                             } else {
                                 if (count++ < 5) {
                                     detectIt(imageFn, options);
                                 } else {
                                     if ('function' === typeof failure) {
                                         failure(publicAmelia, data, lastSuccessfullImage, xhr.status);
                                     }
                                 }
                             }
                         }, function(xhr) {
                        if (count++ < 5) {
                            detectIt(imageFn, options);
                        } else {
                            if ('function' === typeof failure) {
                                failure(publicAmelia, {}, lastSuccessfullImage, xhr.status);
                            }
                        }
                    }
                );
            })
        }
        detectIt(imageFn, options);
    }

    chat.verifyFaceEnrollment = function(nameOrEmail, options) {
        chat._initSession(function() {
            options = options || {};
            var success = options && options.success || undefined;
            var failure = options && options.failure || undefined;

            postJson('/Amelia/api/facereco/enroll/verify',
                     chat._sessionHeaders(
                         {'X-Requested-With': 'XMLHttpRequest',
                             'Content-Type': 'application/json'}),
                     undefined, JSON.stringify({nameOrEmail: nameOrEmail}),
                     function() { },
                     undefined,
                     function(xhr) {
                         var data = JSON.parse(xhr.responseText);
                         if (data.verified === true) {
                             if ('function' === typeof success) {
                                 success(publicAmelia, data, xhr.status);
                             }
                         } else {
                             if ('function' === typeof failure) {
                                 failure(publicAmelia, data, xhr.status);
                             }
                         }
                     },
                     function(xhr) {
                         if ('function' === typeof failure) {
                             failure(publicAmelia, {}, xhr.status);
                         }
                     });

        })
    }

    chat.enrollFace = function(userId, imageFn, options) {
        var numRequests = 0;
        var numFacesStoredForUser = 0;
        var lastSuccessfulImage;
        var lastSuccessfulData;
        var saveIt = function(userId, imageFn, options) {
            var image = imageFn();
            chat._initSession(function() {
                options = options || {};
                var success = options && options.success || undefined;
                var failure = options && options.failure || undefined;
                var payload = chat._convertImage(image);
                payload.userId = userId;
                postJson('/Amelia/api/facereco/enroll/save',
                         chat._sessionHeaders(
                             {'X-Requested-With': 'XMLHttpRequest',
                                 'Content-Type': 'application/json'}),
                         undefined, chat._convertImage(image, { userId: userId}),
                         function() { },
                         undefined,
                         function(xhr) {
                             var data = JSON.parse(xhr.responseText);
                             numRequests++;
                             if (data.enrolled === true) {
                                 numFacesStoredForUser = data.numFacesStoredForUser;
                                 lastSuccessfulImage = image;
                                 lastSuccessfulData = data;
                                 if (numFacesStoredForUser > 2) {
                                     if ('function' === typeof success) {
                                         success(publicAmelia, lastSuccessfulData, lastSuccessfulImage, xhr.status);
                                     }
                                 } else {
                                     saveIt(userId, imageFn, options);
                                 }
                             } else {
                                 numRequests++;
                                 if (numFacesStoredForUser >= 2) {
                                     if ('function' === typeof success) {
                                         success(publicAmelia, lastSuccessfulData, lastSuccessfulImage, xhr.status);
                                     }
                                 } else if (numRequests > 5) {
                                     if ('function' === typeof failure) {
                                         failure(publicAmelia, lastSuccessfulData, lastSuccessfulImage, xhr.status);
                                     }
                                 } else {
                                     saveIt(userId, imageFn, options);
                                 }
                             }
                         }, function(xhr) {
                        if (numRequests > 5) {
                            if ('function' === typeof failure) {
                                failure(publicAmelia, lastSuccessfulData, lastSuccessfulImage, xhr.status);
                            }
                        }
                        numRequests++;
                    });
            })
        }

        saveIt(userId, imageFn, options);
    }

    chat.loginFace = function(image, options) {
        options = options || {};
        chat._initSession(function() {
            postJson('/Amelia/api/facereco/login',
                     chat._sessionHeaders(
                         {'X-Requested-With': 'XMLHttpRequest',
                             'Content-Type': 'application/json'}),
                     undefined, chat._convertImage(image),
                     function() { },
                     undefined,
                     function(xhr) {
            			chat._loginSuccess(xhr);
            			if (typeof options.success === 'function') {
            				options.success(xhr);
						}
					 },
					 function(xhr) {
						 chat._loginFailure(xhr);
						 if (typeof options.failure === 'function') {
							 options.failure(xhr);
						 }
					 });
        })
    }

    chat.recognizeAndSwitch = function(recognizedImage, options) {
        options = options || {};

        if (chat._user === undefined || chat._user.anonymous === true) {
            chat._initSession(function () {
                postJson('/Amelia/api/facereco/recognizeAndSwitch',
                         chat._sessionHeaders(
                             {
                                 'X-Requested-With': 'XMLHttpRequest',
                                 'Content-Type': 'application/json'
                             }),
                         undefined, chat._convertImage(recognizedImage),
                         function () {
                         },
                         undefined,
                         function (xhr) {
                             try {
                                 var data = JSON.parse(xhr.responseText);
                                 if (data.recognized === true) {
                                     chat._setUser(data.user);
                                     if (chat._data === undefined) {
                                         chat._data = {};
                                     }
                                     publicAmelia.fireEvent("loginSuccess", "success", data.user, {});
                                 } else {
                                     publicAmelia.fireEvent("loginFail", "failure", data);
                                 }
                             } catch (err) {
                                 publicAmelia.fireEvent("loginFail", "error", {code: 'UNKNOWN_ERROR', statusText: xhr.statusText});
                             }
                         });
            })
        } else {
            publicAmelia.fireEvent("loginFail", "error", {code: 'CURRENT_USER_NOT_ANONYMOUS', statusText: 200});
        }
    }

	chat.getAvatarImageUrl = function(domainCode) {
		return '/Amelia/api/avatar/image/' + domainCode + '.png'
	}

	chat.getAvatarBrandingUrl = function(domainCode) {
		return '/Amelia/api/avatar/branding/' + domainCode + '.png'
	}

	chat.registerPlugin = function(plugin) {
        if (plugin !== undefined && 'function' === typeof plugin.registerChatPlugin) {
            plugin.registerChatPlugin(publicAmelia);
        }
    };

    chat.registerPlugins = function(plugins) {
        if (plugins.length === 0) return;
        for (var i = 0; i < plugins.length; i++) {
        	chat.registerPlugin(plugins[i]);
		}
    }

	// attach all properties of this closure that do not begin with _ to the public facing object, so that client code has a
	// a restricted public view of the chat, and cannot muck with internal variables or methods at all
	for (var key in chat) {
		if (chat.hasOwnProperty(key) && key.indexOf("_") !== 0) {
			publicAmelia[key] = chat[key];
		}
	}
	//register plugins after publicAmelia set up
	if (config.plugins !== undefined) {
    	if (isArray(config.plugins)) {
            chat.registerPlugins(config.plugins);
		} else {
    		chat.registerPlugin(config.plugins);
		}
	}

	/**
	 * If config.mic is configured, then register our standard STT as a plugin
	 */
	if (config.mic !== undefined) {
		chat.registerPlugin({
			button: config.mic,
			stopDelay: chat._sttDelay,
			recognition: undefined,
			registerChatPlugin: function(chat) {
				var me = this;
				chat.addEventListener('conversationStart', undefined, function () {
					//webkitspeechRecognition working in from and after version 94.0.992.50 for MS Edge,
					//added logic to show the mic button on valid MS Edge versions
					if (navigator.userAgent.indexOf('Edg/') !== -1) {
						var fixedVer = "94.0.992.50";
						var currentVerArr = navigator.userAgent.split('/');
						var currentVer = currentVerArr[currentVerArr.length - 1];
						if(!versionCompare(currentVer, fixedVer)){
							chat.sttMicFail(me.button, 'browser not supported');
							return;
						}
					}

					if (me.recognition === undefined) {
						window.setTimeout(function () {
							var SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
							if (SpeechRecognition === undefined) {
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
								var SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
								var recognition = new SpeechRecognition();
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
										var finalText = recognition._finalResults[recognition._finalResults.length-1];
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
		});

	}

	//initialize the chat when starting
	if (config.autoConnect === true) {
		chat._initialize(config);
	}

	return publicAmelia;
});
