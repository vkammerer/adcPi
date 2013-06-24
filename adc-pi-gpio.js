'use strict';
/**
 * # adcPi
 *
 * [Bit banging](http://en.wikipedia.org/wiki/Bit_banging) communication between ADC and the Raspberry Pi.
 * 
 * Largely inspired by ladyada's script: [https://gist.github.com/ladyada/3151375](https://gist.github.com/ladyada/3151375).
 * 
 * Install `gpio-admin` :
 * ```shell
 * git clone git://github.com/quick2wire/quick2wire-gpio-admin.git
 * cd quick2wire-gpio-admin
 * make
 * sudo make install
 * sudo adduser $USER gpio
 * ```
 *
 * ## Usage
 * See [https://github.com/xseignard/adcPi/blob/master/demo/app.js](https://github.com/xseignard/adcPi/blob/master/demo/app.js)
 */
var gpio = require('pi-gpio'),
	async = require('async'),
	_ = require('underscore'),
	util = require('util'),
	EventEmitter = require('events').EventEmitter,
	adcEventNames = {
		change: 'change',
		ready: 'ready'
	}

/**
 * ADC class, that represents an instance of an ADC.
 * @constructor
 * @param {Object} opts - a configuration object, see the below example
 *     ```js
 *     var opts = {
 *       pins : {
 *         SPICLK: { number: 12, direction: 'out' },
 *         SPIMISO: { number: 16, direction: 'in' },
 *         SPIMOSI: { number: 18, direction: 'out' },
 *         SPICS: { number: 22, direction: 'out' }
 *       },
 *       tolerance : 2,
 *       interval : 300,
 *       channels : [0]
 *     } 
 *     ```
 */
var ADC = function(opts) {
		EventEmitter.call(this);
		opts = opts || {};
		// conf
		this.pins = opts.pins || {
			SPICLK : {number: 12, direction: 'out'},
			SPIMISO : {number: 16, direction: 'in'},
			SPIMOSI : {number: 18, direction: 'out'},
			SPICS : {number: 22, direction: 'out'}
		};
		this.channels = opts.channels || [0];
		this.tolerance = opts.tolerance || 2;
		this.interval = opts.interval || 300;
};
util.inherits(ADC, EventEmitter);

/**
 * Init the pins that are used by the ADC.
 * @param {function()} callback - to be called when init is ok
 * @throws {Error} err - an Error if the initialization went wrong
 */
ADC.prototype.init = function() {
	var _self = this,
	currentValue = -1 - _self.tolerance;

	// to be called for each pin
	var _initGpio = function(pin, done) {
		gpio.open(pin.number, pin.direction, function(err) {
			done();
		});
	};
	var _initChannel = function(channel, done) {
		setInterval(function() {
			_self.read(channel, function(value) {
				if (Math.abs(currentValue - value) > _self.tolerance) {
					var data = {
						channel: channel,
						value: value
					}
					_self.emit(adcEventNames.change, data);
					currentValue = value;
				}
			});
		}, _self.interval);
	}

	// async init of each pins
	async.each(_.toArray(_self.pins), _initGpio, function(err) {
		if (err) throw err;
		_self.emit(adcEventNames.ready);
		async.each(_.toArray(_self.channels), _initChannel, function(err){
			if (err) throw err;
		})
	});
};

/**
 * Read the value of the given ADC channel.
 * @param {Number} channel - the channel number
 * @param {function()} callback - first arg of the callback is the read value
 * @throws {Error} err - an Error if the read went wrong
 */
ADC.prototype.read = function(channel, callback) {
	var _self = this;
	gpio.write(_self.pins.SPICS.number, 1, function() {
		gpio.write(_self.pins.SPICLK.number, 0, function() {
			gpio.write(_self.pins.SPICS.number, 0, function() {
				var cmdOut = channel;
				cmdOut |= 0x18;
				cmdOut <<= 3;
				async.timesSeries(
					// do this 5 times
					5,
					// each time apply this function
					function(n, next) {
						gpio.write(_self.pins.SPIMOSI.number, cmdOut & 0x80, function() {
							cmdOut <<= 1;
							gpio.write(_self.pins.SPICLK.number, 1, function() {
								gpio.write(_self.pins.SPICLK.number, 0, function() {
									next();
								});
							});
						});
					},
					// when done
					function(err) {
						if (err) throw err;
						var adcOut = 0;
						async.timesSeries(
							// do this 12 times
							12,
							// each time apply this function
							function(n, next) {
								gpio.write(_self.pins.SPICLK.number, 1, function() {
									gpio.write(_self.pins.SPICLK.number, 0, function() {
										adcOut <<= 1;
										gpio.read(_self.pins.SPIMISO.number, function(err, value) {
											if (value > 0) {
												adcOut |= 0x1;
											}
											next();
										});
									});
								});
							},
							// when done
							function(err) {
								if (err) throw err;
								gpio.write(_self.pins.SPICS.number, 1, function() {
									adcOut >>= 1;
									if (typeof callback === 'function') callback(adcOut);
								});
							}
						);
					}
				);
			});
		});
	});
};

/**
 * Close the pins used by the ADC.
 * @param {function()} callback - to be called when close is ok
 */
ADC.prototype.close = function (callback) {
	// to be called for each pin
	var _closeGpio = function(pin, done) {
		gpio.close(pin.number, function() {
			done();
		});
	};
	// async close of each pins
	async.each(_.toArray(this.pins), _closeGpio, function(err) {
		if (err) throw err;
		if (typeof callback === 'function') callback();
	});
};

module.exports = ADC;