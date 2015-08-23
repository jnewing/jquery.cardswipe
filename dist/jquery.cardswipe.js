/*! jQuery.CardSwipe Magnetic Stripe Card Reader - v2.0.1 - 2015-08-22
* https://github.com/CarlRaymond/jquery.cardswipe
* Copyright (c) 2015 Carl J. Raymond; Licensed GPLv2 */
// A jQuery plugin to detect magnetic card swipes.  Requires a card reader that simulates a keyboard.
// This expects a card that encodes data on track 1, though it also reads tracks 2 and 3.  Most cards
// use track 1.  This won't recognize cards that don't use track 1, or work with a reader that
// doesn't read track 1.
//
// See http://en.wikipedia.org/wiki/Magnetic_card to understand the format of the data on a card.
//
// Uses pattern at https://github.com/umdjs/umd/blob/master/jqueryPlugin.js to declare
// the plugin so that it works with or without an AMD-compatible module loader, like RequireJS.
(function (factory) {
    if (typeof define === 'function' && define.amd) {
        // AMD. Register as an anonymous module.
        define(['jquery'], factory);
    } else {
        // Browser globals
        factory(jQuery);
    }
}(function ($) {

	// Built-in parsers. These include simplistic credit card parsers that
	// recognize various card issuers based on patterns of the account number.
	// There is no guarantee these are correct or complete; they are based
	// on information from Wikipedia.
	// Account numbers are validated by the Luhn checksum algorithm.
	var builtinParsers = {

		// Generic parser. Separates raw data into up to three lines.
		generic: function (rawData) {
				var pattern = new RegExp("^(%[^%;\\?]+\\?)?(;[0-9\\:<>\\=]+\\?)?([+;][0-9\\:<>\\=]+\\?)?");

				var match = pattern.exec(rawData);
				if (!match) return null;

				// Extract the three lines
				var cardData = {
					type: "generic",
					line1: match[1] ? match[1].substr(1, match[1].length-2) : "",
					line2: match[2] ? match[2].substr(1, match[2].length-2) : "",
					line3: match[3] ? match[3].substr(1, match[3].length-2) : "",
				};

				return cardData;
			},
		

		// Visa card parser.
		visa: function (rawData) {
			// Visa issuer number begins with 4 and may vary from 13 to 19 total digits. 16 digits is most common.
			var pattern = new RegExp("^%B(4[0-9]{12,18})\\^([A-Z ]+)/([A-Z ]+)\\^([0-9]{2})([0-9]{2})");

			var match = pattern.exec(rawData);
			if (!match) return null;

			var account = match[1];
			if (!luhnCheck(account))
				return null;

			var cardData = {
				type: "visa",
				account: account,
				lastName: match[2].trim(),
				firstName: match[3].trim(),
				expYear: match[4],
				expMonth: match[5]
			};

			return cardData;
		},

		// MasterCard parser.
		mastercard: function (rawData) {
			// MasterCard starts with 51-55, and is 16 digits long.
			var pattern = new RegExp("^%B(5[1-5][0-9]{14})\\^([A-Z ]+)/([A-Z ]+)\\^([0-9]{2})([0-9]{2})");

			var match = pattern.exec(rawData);
			if (!match) return null;

			var account = match[1];
			if (!luhnCheck(account))
				return null;

			var cardData = {
				type: "mastercard",
				account: account,
				lastName: match[2],
				firstName: match[3],
				expYear: match[4],
				expMonth: match[5]
			};

			return cardData;
		},

		// American Express parser
		amex: function (rawData) {
			// American Express starts with 34 or 37, and is 15 digits long.
			var pattern = new RegExp("^%B(3[4|7][0-9]{13})\\^([A-Z ]+)/([A-Z ]+)\\^([0-9]{2})([0-9]{2})");

			var match = pattern.exec(rawData);
			if (!match) return null;

			var account = match[1];
			if (!luhnCheck(account))
				return null;

			var cardData = {
				type: "amex",
				account: account,
				lastName: match[2],
				firstName: match[3],
				expYear: match[4],
				expMonth: match[5]
			};

			return cardData;
		},
	};




	// State definitions:
	var states = { IDLE: 0, PENDING: 1, READING: 2, DISCARD: 3, PREFIX: 4 };

	// State names used when debugging.
	var stateNames = { 0: 'IDLE', 1: 'PENDING', 2: 'READING', 3: 'DISCARD', 4: 'PREFIX' };

	// Holds current state. Update only through state function.
	var currentState = states.IDLE;

	// Gets or sets the current state.
	var state = function() {

		if (arguments.length === 0) {
			return currentState;
		}

		// Set new state.
		var newState = arguments[0];
		if (newState == state)
			return;

		if (settings.debug) { console.log("%s -> %s", stateNames[currentState], stateNames[newState]); }

		// Raise events when entering and leaving the READING state
		if (newState == states.READING)
			$(document).trigger("scanstart.cardswipe");

		if (currentState == states.READING)
			$(document).trigger("scanend.cardswipe");

		currentState = newState;
	};

	// Array holding scanned characters
	var scanbuffer;
	
	// Interdigit timer
	var timerHandle = 0;

	// Keypress listener
	var listener = function (e) {
		if (settings.debug) { console.log(e.which + ': ' + String.fromCharCode(e.which));}
		switch (state()) {

			// IDLE: Look for '%', and jump to PENDING.
			case states.IDLE:
				// Look for '%'
				if (e.which == 37) {
					state(states.PENDING);
					scanbuffer = [];
					processCode(e.which);
					e.preventDefault();
					e.stopPropagation();
					startTimer();
				}

				// Look for prefix, if defined, and jump to PREFIX.
				if (settings.prefixCode && settings.prefixCode == e.which) {
					state(states.PREFIX);
					e.preventDefault();
					e.stopPropagation();
					startTimer();
				}

				break;

			// PENDING: Look for A-Z, then jump to READING.  Otherwise, pass the keypress through, reset and jump to IDLE.
			case states.PENDING:
				// Look for format code character, A-Z. Almost always B for cards
				// used by the general public. Some reader / OS combinations
				// will issue lowercase characters when the caps lock key is on.
				if ((e.which >= 65 && e.which <= 90) || (e.which >= 97 && e.which <= 122)) {
					state(states.READING);

					// Leaving focus on a form element wreaks browser-dependent
					// havoc because of keyup and keydown events.  This is a
					// cross-browser way to prevent trouble.
					$("input").blur();

					processCode(e.which);
					e.preventDefault();
					e.stopPropagation();
					startTimer();
				}
				else {
					clearTimer();
					scanbuffer = null;
					state(states.IDLE);
				}
				break;

			// READING: Copy characters to buffer until newline, then process the scanned characters
			case states.READING:
				processCode(e.which);
				startTimer();
				e.preventDefault();
				e.stopPropagation();

				// Carriage return indicates end of scan
				if (e.which == 13) {
					clearTimer();
					state(states.IDLE);
					processScan();
				}

				if (settings.firstLineOnly && e.which == 63) {
					// End of line 1.  Return early, and eat remaining characters.
				  state(states.DISCARD);
				  processScan();
				}
				break;

			// DISCARD: Eat up characters until newline, then jump to IDLE
			case states.DISCARD:
				e.preventDefault();
				e.stopPropagation();
				if (e.which == 13) {
					clearTimer();
					state(states.IDLE);
					return;
				}

				startTimer();
				break;

			// PREFIX: Eat up characters until % is seen, then jump to PENDING
			case states.PREFIX:

				// If prefix character again, pass it through and return to IDLE state.
				if (e.which == settings.prefixCode) {
					state(states.IDLE);
					return;
				}

				// Eat character.
				e.preventDefault();
				e.stopPropagation();
				// Look for '%'
				if (e.which == 37) {
					state(states.PENDING);
					scanbuffer = [];
					processCode(e.which);
				}
				startTimer();
		}
	};

	// Converts a scancode to a character and appends it to the buffer.
	var processCode = function (code) {
		scanbuffer.push(String.fromCharCode(code));
	};

	var startTimer = function () {
		clearTimeout(timerHandle);
		timerHandle = setTimeout(onTimeout, settings.interdigitTimeout);
	};

	var clearTimer = function () {
		clearTimeout(timerHandle);
		timerHandle = 0;
	};

	// Invoked when the timer lapses.
	var onTimeout = function () {
		if (settings.debug) { console.log('Timeout!'); }
		if (state() == states.READING) {
			processScan();
		}
		scanbuffer = null;
		state(states.IDLE);
	};


	// Processes the scanned card
	var processScan = function () {

		if (settings.debug) {
			console.log(scanbuffer);
		}

		var rawData = scanbuffer.join('');

		// Invoke rawData callback if defined, a testing hook.
		if (settings.rawDataCallback) { settings.rawDataCallback.call(this, rawData); }

		parseData(rawData);
	};

	var parseData = function(rawData) {
	  // Invoke client parsers until one succeeds
		for (var i = 0; i < settings.parsers.length; i++) {
		  var ref = settings.parsers[i];
		  var parser;

			// ref is a function or the name of a builtin parser
		  if ($.isFunction(ref)) {
		    parser = ref;
		  }
		  else if (typeof (ref) === "string") {
		    parser = builtinParsers[ref];
		  }

		  if (parser != null)
		  {
		    var parsedData = parser.call(this, rawData);
		    if (parsedData == null)
		      continue;

		  	// Scan complete. Invoke callback
		    if (settings.complete) { settings.complete.call(this, parsedData); }

				// Raise success event.
		    $(document).trigger("success.cardswipe", parsedData);

		    // For test purposes, return parsedData here
		    return parsedData;
		  }
		}

		// All parsers failed.
		if (settings.error) { settings.error.call(this, rawData); }
		$(document).trigger("failure.cardswipe");
	};

	// Binds the event listener
	var bindListener = function () {
		$(document).bind("keypress", listener);
	};

	// Unbinds the event listener
	var unbindListener = function () {
		$(document).unbind("keypress", listener);
	};

	// Default callback used if no other specified. Works with default parser.
	var defaultCompleteCallback = function (cardData) {
		var text = ['Line 1: ', cardData.line1, '\nLine 2: ', cardData.line2, '\nLine 3: ', cardData.line3].join('');
		alert(text);
	};

	// Defaults for settings
	var defaults = {
		enabled: true,
		interdigitTimeout: 250,
		complete: defaultCompleteCallback,
		error: null,
		parsers: [ "generic" ],
		firstLineOnly: false,
		prefixCharacter: null,
		debug: false,
	};

	// Plugin actual settings
	var settings;


	// Apply the Luhn checksum test.  Returns true on a valid account number.
	// The input is assumed to be a string containing only digits.
	var luhnCheck = function (digits) {
		var map = [0, 2, 4, 6, 8, 1, 3, 5, 7, 9];
		var sum = 0;

		// Proceed right to left. Even and odd digit positions are handled differently.
		var n = digits.length;
		var odd = true;
		while (n--) {
			var d = parseInt(digits.charAt(n), 10);
			if (odd) {
				// Odd digits used as is
				sum += d;
			}
			else {
				// Even digits mapped
				sum += map[d];
			}

			odd = !odd;
		}

		return sum % 10 === 0 && sum > 0;
	};

	// Callable plugin methods
	var methods = {
		init: function (options) {
			settings = $.extend(defaults, options || {});

			// Is a prefix character defined?
			if (settings.prefixCharacter) {
				if (settings.prefixCharacter.length != 1)
					throw 'PrefixCharacter must be a single character';

				// Convert to character code
				settings.prefixCode = settings.prefixCharacter.charCodeAt(0);
			}

			if (settings.enabled)
				methods.enable();
		},

		disable: function () {
			unbindListener();
		},

		enable: function () {
			bindListener();
		},

		// Method to allow easy testing of parsers. The supplied raw character data, as a string,
		// are run through the parsers, and the processed scan data is returned. The compete or
		// fail callback will be invoked, and the success.cardswipe and failure.cardswipe events
		// will be raised. The scanstart.cardswipe and scanend.cardswipe events will not be
		// raised.
		_parseData: function(rawData) {
			return parseData(rawData);
		}
	};

	// The plugin proper.  Dispatches methods using the usual jQuery pattern.
	$.cardswipe = function (method) {
		// Method calling logic. If named method exists, execute it with passed arguments
		if (methods[method]) {
			return methods[method].apply(this, Array.prototype.slice.call(arguments, 1));
		}
			// If no argument, or an object passed, invoke init method.
		else if (typeof method === 'object' || !method) {
			return methods.init.apply(this, arguments);
		}
		else {
			throw 'Method ' + method + ' does not exist on jQuery.cardswipe';
		}
	};



}));
