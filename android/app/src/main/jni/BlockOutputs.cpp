// Copyright (c) 2018, The TurtleCoin Developers
// Copyright (c) 2026, XTE Foundation
//
// Please see the included LICENSE file for more information.
//
// Platform independent wallet sync helper. Shared by the Android JNI bridge
// (TurtleCoin.cpp) and the iOS native module (ios/XTE/XTEModule.mm).

#include "BlockOutputs.h"

#include "crypto.h"

std::vector<std::tuple<Crypto::PublicKey, TransactionInput>> processBlockOutputs(
    const WalletBlockInfo &block,
    const Crypto::SecretKey &privateViewKey,
    const std::unordered_map<Crypto::PublicKey, Crypto::SecretKey> &spendKeys,
    const bool isViewWallet,
    const bool processCoinbaseTransactions)
{

    std::vector<std::tuple<Crypto::PublicKey, TransactionInput>> inputs;

    /* Process the coinbase tx if we're not skipping them for speed */
    if (processCoinbaseTransactions && block.coinbaseTransaction)
    {
        processTransactionOutputs(
            *block.coinbaseTransaction, privateViewKey, spendKeys, isViewWallet, inputs
        );
    }

    /* Process the normal txs */
    for (const auto &tx : block.transactions)
    {
        processTransactionOutputs(
            tx, privateViewKey, spendKeys, isViewWallet, inputs
        );
    }

    return inputs;
}

void processTransactionOutputs(
    const RawTransaction &tx,
    const Crypto::SecretKey &privateViewKey,
    const std::unordered_map<Crypto::PublicKey, Crypto::SecretKey> &spendKeys,
    const bool isViewWallet,
    std::vector<std::tuple<Crypto::PublicKey, TransactionInput>> &inputs)
{
    Crypto::KeyDerivation derivation;

    /* Generate the key derivation from the random tx public key, and our private
       view key */
    Crypto::generate_key_derivation(
        tx.transactionPublicKey, privateViewKey, derivation
    );

    uint32_t outputIndex = 0;

    for (const auto &output : tx.keyOutputs)
    {
        Crypto::PublicKey derivedSpendKey;

        /* Derive the public spend key from the transaction, using the previous 
           derivation */
        Crypto::underive_public_key(
            derivation, outputIndex, output.key, derivedSpendKey
        );

        /* See if the derived spend key matches any of our spend keys */
        const auto ourPrivateSpendKey = spendKeys.find(derivedSpendKey);

        /* If it does, the transaction belongs to us */
        if (ourPrivateSpendKey != spendKeys.end())
        {
            TransactionInput input;

            input.amount = output.amount;
            input.transactionIndex = outputIndex;
            input.globalOutputIndex = output.globalIndex;
            input.key = output.key;
            input.parentTransactionHash = tx.hash;

            if (!isViewWallet)
            {
                /* Make a temporary key pair */
                Crypto::PublicKey tmpPublicKey;
                Crypto::SecretKey tmpSecretKey;

                /* Get the tmp public key from the derivation, the index,
                   and our public spend key */
                Crypto::derive_public_key(
                    derivation, outputIndex, derivedSpendKey, tmpPublicKey
                );

                /* Get the tmp private key from the derivation, the index,
                   and our private spend key */
                Crypto::derive_secret_key(
                    derivation, outputIndex, ourPrivateSpendKey->second, tmpSecretKey
                );

                /* Get the key image from the tmp public and private key */
                Crypto::generate_key_image(
                    tmpPublicKey, tmpSecretKey, input.keyImage
                );
            }

            inputs.emplace_back(derivedSpendKey, input);
        }

        outputIndex++;
    }
}
