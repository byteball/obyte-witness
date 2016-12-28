/*jslint node: true */
"use strict";
var conf = require('byteballcore/conf.js');
var db = require('byteballcore/db.js');
var eventBus = require('byteballcore/event_bus.js');
var mail = require('byteballcore/mail.js');
var headlessWallet = require('headless-byteball');
var desktopApp = require('byteballcore/desktop_app.js');
var objectHash = require('byteballcore/object_hash.js');

var WITNESSING_COST = 600; // size of typical witnessing unit
var my_address;
var bWitnessingUnderWay = false;
var forcedWitnessingTimer;

if (!conf.bSingleAddress)
	throw Error('witness must be single address');

headlessWallet.setupChatEventHandlers();

function notifyAdmin(subject, body){
	mail.sendmail({
		to: conf.admin_email,
		from: conf.from_email,
		subject: subject,
		body: body
	});
}

function notifyAdminAboutFailedWitnessing(err){
	console.log('witnessing failed: '+err);
	notifyAdmin('witnessing failed: '+err, err);
}

function notifyAdminAboutWitnessingProblem(err){
	console.log('witnessing problem: '+err);
	notifyAdmin('witnessing problem: '+err, err);
}


function witness(onDone){
	function onError(err){
		notifyAdminAboutFailedWitnessing(err);
		setTimeout(onDone, 60000); // pause after error
	}
	var network = require('byteballcore/network.js');
	var composer = require('byteballcore/composer.js');
	createOptimalOutputs(function(arrOutputs){
		let params = {
			paying_addresses: [my_address], 
			outputs: arrOutputs, 
			signer: headlessWallet.signer, 
			callbacks: composer.getSavingCallbacks({
				ifNotEnoughFunds: onError,
				ifError: onError,
				ifOk: function(objJoint){
					network.broadcastJoint(objJoint);
					onDone();
				}
			})
		};
		if (conf.bPostTimestamp){
			let timestamp = Date.now();
			let datafeed = {timestamp: timestamp};
			let objMessage = {
				app: "data_feed",
				payload_location: "inline",
				payload_hash: objectHash.getBase64Hash(datafeed),
				payload: datafeed
			};
			params.messages = [objMessage];
		}
		composer.composeJoint(params);
	});
}

function checkAndWitness(){
	clearTimeout(forcedWitnessingTimer);
	if (bWitnessingUnderWay)
		return;
	bWitnessingUnderWay = true;
	// abort if there are my units without an mci
	determineIfThereAreMyUnitsWithoutMci(function(bMyUnitsWithoutMci){
		if (bMyUnitsWithoutMci){
			bWitnessingUnderWay = false;
			return;
		}
		db.query("SELECT MAX(main_chain_index) AS max_mci FROM units", function(rows){
			var max_mci = rows[0].max_mci;
			db.query("SELECT MAX(main_chain_index) AS max_my_mci FROM units JOIN unit_authors USING(unit) WHERE address=?", [my_address], function(rows){
				var max_my_mci = (rows.length > 0) ? rows[0].max_my_mci : -1000;
				var distance = max_mci - max_my_mci;
				console.log("distance="+distance);
				if (distance > conf.THRESHOLD_DISTANCE){
					console.log('distance above threshold, will witness');
					witness(function(){
						bWitnessingUnderWay = false;
					});
				}
				else{
					bWitnessingUnderWay = false;
					checkForUnconfirmedUnits(conf.THRESHOLD_DISTANCE - distance);
				}
			});
		});
	});
}

function determineIfThereAreMyUnitsWithoutMci(handleResult){
	db.query("SELECT 1 FROM units JOIN unit_authors USING(unit) WHERE address=? AND main_chain_index IS NULL LIMIT 1", [my_address], function(rows){
		handleResult(rows.length > 0);
	});
}

function checkForUnconfirmedUnits(distance_to_threshold){
	db.query( // look for unstable non-witness-authored units
		"SELECT 1 FROM units JOIN unit_authors USING(unit) LEFT JOIN my_witnesses USING(address) WHERE is_stable=0 AND my_witnesses.address IS NULL LIMIT 1",
		function(rows){
			if (rows.length === 0)
				return;
			var timeout = Math.round((distance_to_threshold + Math.random())*10000);
			console.log('scheduling unconditional witnessing in '+timeout+' ms unless a new unit arrives');
			forcedWitnessingTimer = setTimeout(witnessBeforeThreshold, timeout);
		}
	);
}

function witnessBeforeThreshold(){
	if (bWitnessingUnderWay)
		return;
	bWitnessingUnderWay = true;
	determineIfThereAreMyUnitsWithoutMci(function(bMyUnitsWithoutMci){
		if (bMyUnitsWithoutMci){
			bWitnessingUnderWay = false;
			return;
		}
		console.log('will witness before threshold');
		witness(function(){
			bWitnessingUnderWay = false;
		});
	});
}

function readNumberOfWitnessingsAvailable(handleNumber){
	db.query(
		"SELECT COUNT(*) AS count_big_outputs FROM outputs JOIN units USING(unit) \n\
		WHERE address=? AND is_stable=1 AND amount>=? AND asset IS NULL AND is_spent=0", 
		[my_address, WITNESSING_COST], 
		function(rows){
			var count_big_outputs = rows[0].count_big_outputs;
			db.query(
				"SELECT SUM(amount) AS total FROM outputs JOIN units USING(unit) \n\
				WHERE address=? AND is_stable=1 AND amount<? AND asset IS NULL AND is_spent=0 \n\
				UNION \n\
				SELECT SUM(amount) AS total FROM witnessing_outputs \n\
				WHERE address=? AND is_spent=0 \n\
				UNION \n\
				SELECT SUM(amount) AS total FROM headers_commission_outputs \n\
				WHERE address=? AND is_spent=0", 
				[my_address, WITNESSING_COST, my_address, my_address], 
				function(rows){
					var total = rows.reduce(function(prev, row){ return (prev + row.total); }, 0);
					var count_witnessings_paid_by_small_outputs_and_commissions = Math.round(total / WITNESSING_COST);
					handleNumber(count_big_outputs + count_witnessings_paid_by_small_outputs_and_commissions);
				}
			);
		}
	);
}

// make sure we never run out of spendable (stable) outputs. Keep the number above a threshold, and if it drops below, produce more outputs than consume.
function createOptimalOutputs(handleOutputs){
	var arrOutputs = [{amount: 0, address: my_address}];
	readNumberOfWitnessingsAvailable(function(count){
		if (count > conf.MIN_AVAILABLE_WITNESSINGS)
			return handleOutputs(arrOutputs);
		// try to split the biggest output in two
		db.query(
			"SELECT amount FROM outputs JOIN units USING(unit) \n\
			WHERE address=? AND is_stable=1 AND amount>=? AND asset IS NULL AND is_spent=0 \n\
			ORDER BY amount DESC LIMIT 1", 
			[my_address, 2*WITNESSING_COST],
			function(rows){
				if (rows.length === 0){
					notifyAdminAboutWitnessingProblem('only '+count+" spendable outputs left, and can't add more");
					return handleOutputs(arrOutputs);
				}
				var amount = rows[0].amount;
				notifyAdminAboutWitnessingProblem('only '+count+" spendable outputs left, will split an output of "+amount);
				arrOutputs.push({amount: Math.round(amount/2), address: my_address});
				handleOutputs(arrOutputs);
			}
		);
	});
}

eventBus.on('headless_wallet_ready', function(){
	if (!conf.admin_email || !conf.from_email){
		console.log("please specify admin_email and from_email in your "+desktopApp.getAppDataDir()+'/conf.json');
		process.exit(1);
	}
	headlessWallet.readSingleAddress(function(address){
		my_address = address;
		//checkAndWitness();
		eventBus.on('new_joint', checkAndWitness); // new_joint event is not sent while we are catching up
	});
});
