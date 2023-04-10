// Requirements: https://nodejs.org/en/download 
// After installing 
// in project directory open terminal and run 
// $ npm install 

// Obtain blockfrost ID/key on https://blockfrost.io/
const BLOCKFROST_ID = 'paste-blockfrost-key-here'

// Receiving address where all the ADA will go
const RECEIVE_ADDR = 'paste-receiving-address-here'

// Your private key (byron)
const PRIVATE_KEY = 'paste-private-key-here'

const {
    Value,
    BigNum,
    Address,
    LinearFee,
    Transaction,
    ByronAddress,
    Bip32PrivateKey,
    TransactionHash,
    hash_transaction,
    TransactionInput,
    TransactionOutput,
    TransactionBuilder,
    BootstrapWitnesses,
    TransactionWitnessSet,
    make_icarus_bootstrap_witness,
    TransactionBuilderConfigBuilder,
} = require('@emurgo/cardano-serialization-lib-nodejs')

const axios = require('axios')


function harden (t) {
    return 2147483648 + t;
}

// Private key
const rootKey = Bip32PrivateKey.from_bytes(Buffer.from(PRIVATE_KEY, 'hex'));

// Derived key
const deriveKey = rootKey
    .derive(harden(44))
    .derive(harden(1815))
    .derive(harden(0))
    .derive(0)
    .derive(0)

// Byron address from derived key
const byronAddress = ByronAddress.icarus_from_key(deriveKey.to_public(), 764824073)

// build and submit transaction
const restore = async () => {

    // basic transaction from cardanowasm-lib-nodejs 
    const linearFee = LinearFee.new(
        BigNum.from_str('44'),
        BigNum.from_str('155381')
    );
    
    const txBuilderCfg = TransactionBuilderConfigBuilder.new()
        .fee_algo(linearFee)
        .pool_deposit(BigNum.from_str('500000000'))
        .key_deposit(BigNum.from_str('2000000'))
        .max_value_size(4000)
        .max_tx_size(8000)
        .coins_per_utxo_word(BigNum.from_str('34482'))
        .build()
        
    let lovelace = 0

    // query utxos 
    const utxos = await axios.get(`https://cardano-mainnet.blockfrost.io/api/v0/addresses/${byronAddress.to_base58()}/utxos`, {headers: {'project_id': BLOCKFROST_ID}})
        .then(response => response.data)

    const txBuilder = TransactionBuilder.new(txBuilderCfg)

    utxos
        .forEach(utxo => {
            utxo.amount
                .forEach(amount => amount.unit == 'lovelace' ? lovelace += parseInt(amount.quantity) : false)
        })

    utxos
        .forEach(utxo => {
            // add output to the tx
            const love = utxo.amount.filter(amount => amount.unit == 'lovelace')[0]

            txBuilder.add_bootstrap_input(
                byronAddress,
                TransactionInput.new(
                    TransactionHash.from_bytes(Buffer.from(utxo.tx_hash, "hex"),), 
                    utxo.tx_index,
                ),
                Value.new(BigNum.from_str(String(love.quantity)))
            );
    })

    // base address
    const shelleyOutputAddress = Address.from_bech32(RECEIVE_ADDR);

    // pointer address
    const shelleyChangeAddress = Address.from_bech32(RECEIVE_ADDR);

    txBuilder.add_output(
        TransactionOutput.new(
            shelleyOutputAddress,
            Value.new(BigNum.from_str(String(1000000)))    
        ),
    );

    // set the time to live - the absolute slot value before the tx becomes invalid
    const slot = await axios.get('https://cardano-mainnet.blockfrost.io/api/v0/blocks/latest', {headers: {'project_id': BLOCKFROST_ID}})
        .then(response => response.data)
        .then(network => network.slot)
        .then(slot => slot + 20)

    txBuilder.set_ttl(slot);

    // calculate the min fee required and send any change to an address
    txBuilder.add_change_if_needed(shelleyChangeAddress);


    // once the transaction is ready, we build it to get the tx body without witnesses
    const txBody = txBuilder.build();
    const txHash = hash_transaction(txBody);
    const witnesses = TransactionWitnessSet.new();


    // add bootstrap (Byron-era) witnesses
    const cip1852Account = Bip32PrivateKey.from_bech32(deriveKey.to_bech32());
    const bootstrapWitnesses = BootstrapWitnesses.new();
    const bootstrapWitness = make_icarus_bootstrap_witness(
        txHash,
        byronAddress,
        cip1852Account,
    );

    bootstrapWitnesses.add(bootstrapWitness);
    witnesses.set_bootstraps(bootstrapWitnesses);

    // create the finalized transaction with witnesses
    const transaction = Transaction.new(
        txBody,
        witnesses,
        undefined, // transaction metadata
    );

    // ! view transaction first before submitting
    console.log(transaction.to_json())
    
    
    // ! submit transaction
    // ! uncomment lines below to submit 
    
    // await axios.post('https://cardano-mainnet.blockfrost.io/api/v0/tx/submit',
    //     transaction.to_bytes(),
    //     {
    //       headers: {
    //         'Content-Type': 'application/cbor',
    //         'project_id': BLOCKFROST_ID
    //       }
    //     })
    //     .then(response => response.data)
    //     .then(tx => console.log(`https://cardanoscan.io/transaction${tx}`))
};    

(async () => await restore().catch(console.log))();