# Witness node in Byteball network

This is an example of witness node for Byteball network.  It periodically posts transactions from the same address.

Running this code is not the only way to run a witness.  If some other (more useful) activity implies frequent posting from a constant address, this address can become a witness address.  For example, if you are an oracle and already post frequently enough, then you can become a witness as well.  Some oracles who are already doing it are [price oracle](../../../byteball-data-feed) and [Bitcoin oracle](../../../btc-oracle).  The code in this module is a "naked" witness, which just periodically posts transactions that move money to itself.

## Requirements

To become a winess, you are expected to:

* have a publicly known real name, no anonymity
* be well known in the community
* be trusted
* have a lot to lose (material and/or nonmaterial) in case of misbehavior.  The loss is your business (outside Byteball) and/or reputation
* have enough technical expertise to ensure uninterrupted operation 24/7 and security of your private keys (they must not be stolen and used to post on your behalf)
* be prepared to adapt your own witness list when you feel the community wants to change the list in some way and the new candidate satisfies the above rules.  This includes removing your witness from the witness list.

If you think that you satisfy these criteria, this is your course of action:
* start running this code, or other code that periodically posts from a constant address.  At this point you are burning money on fees and not earning anything as witness.
* convince the community that you would be a better witness than some other witness you are going to replace.  If users agree with you, they manually change their witness lists to set your witness address in place of somebody else
* wait that other witnesses take note of the changing community opinion and change their witness lists accordingly

## Install

Install node.js, clone the repository, then say
```sh
npm install
```
Enabling TOR is highly recommended in order to keep your IP address unknown to potential attackers.  See [byteballcore](../../../byteballcore) documentation.

## Run
```sh
node start.js
```
Witness node is based on headless node, see its [documentation about running and configuring a headless node](../../../headless-byteball).
