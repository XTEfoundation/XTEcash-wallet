// Copyright (c) 2018, The TurtleCoin Developers
// Copyright (c) 2026, XTE Foundation
//
// Please see the included LICENSE file for more information.
//
// iOS bridge for the native CryptoNote helpers. The C++ sources are shared
// with Android and live in android/app/src/main/jni (crypto.cpp,
// BlockOutputs.cpp, ...). This file only converts between hex strings /
// JS objects and the native types, mirroring XTEModule.java + TurtleCoin.cpp.

#import "XTEModule.h"

#include <cmath>
#include <cstring>
#include <limits>
#include <optional>
#include <string>
#include <tuple>
#include <unordered_map>
#include <vector>

#include "BlockOutputs.h"
#include "crypto.h"

namespace
{
    /* Thrown when JS hands us something we cannot convert. Caught in every
       exported method and turned into a promise rejection. */
    struct XTEArgumentError
    {
        std::string message;
    };

    int hexCharToInt(const char c)
    {
        if (c >= '0' && c <= '9')
        {
            return c - '0';
        }

        if (c >= 'A' && c <= 'F')
        {
            return c - 'A' + 10;
        }

        if (c >= 'a' && c <= 'f')
        {
            return c - 'a' + 10;
        }

        throw XTEArgumentError{"Invalid hex character"};
    }

    void hexToBytes(id value, uint8_t *output, const size_t outputLength, const char *name)
    {
        if (![value isKindOfClass:[NSString class]])
        {
            throw XTEArgumentError{std::string(name) + " must be a hex string"};
        }

        const char *hex = [(NSString *)value UTF8String];

        if (hex == nullptr || std::strlen(hex) != outputLength * 2)
        {
            throw XTEArgumentError{std::string(name) + " has the wrong length"};
        }

        for (size_t i = 0; i < outputLength; i++)
        {
            output[i] = static_cast<uint8_t>(hexCharToInt(hex[i * 2]) * 16 + hexCharToInt(hex[i * 2 + 1]));
        }
    }

    template<typename T>
    T makeNative32ByteKey(id value, const char *name)
    {
        T result;
        hexToBytes(value, result.data, 32, name);
        return result;
    }

    template<typename T>
    T makeNative64ByteKey(id value, const char *name)
    {
        T result;
        hexToBytes(value, result.data, 64, name);
        return result;
    }

    NSString *bytesToHex(const uint8_t *input, const size_t length)
    {
        static const char hexChars[] = "0123456789abcdef";

        std::string output(length * 2, '0');

        for (size_t i = 0; i < length; i++)
        {
            output[i * 2] = hexChars[(input[i] >> 4) & 0x0F];
            output[i * 2 + 1] = hexChars[input[i] & 0x0F];
        }

        return [NSString stringWithUTF8String:output.c_str()];
    }

    template<typename T>
    NSString *make32ByteKey(const T &key)
    {
        return bytesToHex(key.data, 32);
    }

    template<typename T>
    NSString *make64ByteKey(const T &key)
    {
        return bytesToHex(key.data, 64);
    }

    NSDictionary *requireDictionary(id value, const char *name)
    {
        if (![value isKindOfClass:[NSDictionary class]])
        {
            throw XTEArgumentError{std::string(name) + " must be an object"};
        }

        return (NSDictionary *)value;
    }

    NSArray *requireArray(id value, const char *name)
    {
        if (![value isKindOfClass:[NSArray class]])
        {
            throw XTEArgumentError{std::string(name) + " must be an array"};
        }

        return (NSArray *)value;
    }

    double requireNumber(id value, const char *name)
    {
        if (![value isKindOfClass:[NSNumber class]])
        {
            throw XTEArgumentError{std::string(name) + " must be a number"};
        }

        return [(NSNumber *)value doubleValue];
    }

    /* Same semantics as the Java bridge: JS numbers are doubles, the
       native code wants 64 bit integers. */
    uint64_t toUInt64(const double value)
    {
        if (!(value > 0))
        {
            return 0;
        }

        if (value >= 18446744073709551615.0)
        {
            return std::numeric_limits<uint64_t>::max();
        }

        return static_cast<uint64_t>(value);
    }

    int64_t toInt64(const double value)
    {
        if (std::isnan(value))
        {
            return 0;
        }

        if (value >= 9223372036854775807.0)
        {
            return std::numeric_limits<int64_t>::max();
        }

        if (value <= -9223372036854775808.0)
        {
            return std::numeric_limits<int64_t>::min();
        }

        return static_cast<int64_t>(value);
    }

    std::vector<Crypto::PublicKey> makeNativePublicKeys(id value)
    {
        std::vector<Crypto::PublicKey> keys;

        for (id key in requireArray(value, "inputKeys"))
        {
            keys.push_back(makeNative32ByteKey<Crypto::PublicKey>(key, "inputKeys[]"));
        }

        return keys;
    }

    std::vector<Crypto::Signature> makeNativeSignatures(id value)
    {
        std::vector<Crypto::Signature> signatures;

        for (id signature in requireArray(value, "signatures"))
        {
            signatures.push_back(makeNative64ByteKey<Crypto::Signature>(signature, "signatures[]"));
        }

        return signatures;
    }

    KeyOutput makeNativeKeyOutput(id value)
    {
        NSDictionary *map = requireDictionary(value, "keyOutput");

        KeyOutput output;

        output.key = makeNative32ByteKey<Crypto::PublicKey>(map[@"key"], "keyOutput.key");
        output.amount = toUInt64(requireNumber(map[@"amount"], "keyOutput.amount"));

        id globalIndex = map[@"globalIndex"];

        output.globalIndex = [globalIndex isKindOfClass:[NSNumber class]]
            ? toInt64([(NSNumber *)globalIndex doubleValue])
            : -1;

        return output;
    }

    RawTransaction makeNativeRawTransaction(id value)
    {
        NSDictionary *map = requireDictionary(value, "transaction");

        RawTransaction tx;

        for (id keyOutput in requireArray(map[@"keyOutputs"], "transaction.keyOutputs"))
        {
            tx.keyOutputs.push_back(makeNativeKeyOutput(keyOutput));
        }

        id hash = map[@"hash"];

        if (![hash isKindOfClass:[NSString class]])
        {
            throw XTEArgumentError{"transaction.hash must be a string"};
        }

        tx.hash = std::string([(NSString *)hash UTF8String]);

        tx.transactionPublicKey = makeNative32ByteKey<Crypto::PublicKey>(
            map[@"transactionPublicKey"], "transaction.transactionPublicKey"
        );

        return tx;
    }

    WalletBlockInfo makeNativeWalletBlockInfo(id value)
    {
        NSDictionary *map = requireDictionary(value, "block");

        WalletBlockInfo block;

        id coinbaseTransaction = map[@"coinbaseTransaction"];

        if (coinbaseTransaction != nil && coinbaseTransaction != [NSNull null])
        {
            block.coinbaseTransaction = makeNativeRawTransaction(coinbaseTransaction);
        }

        for (id tx in requireArray(map[@"transactions"], "block.transactions"))
        {
            block.transactions.push_back(makeNativeRawTransaction(tx));
        }

        return block;
    }

    std::unordered_map<Crypto::PublicKey, Crypto::SecretKey> makeNativeSpendKeys(id value)
    {
        std::unordered_map<Crypto::PublicKey, Crypto::SecretKey> spendKeys;

        for (id item in requireArray(value, "spendKeys"))
        {
            NSDictionary *map = requireDictionary(item, "spendKey");

            const auto publicKey = makeNative32ByteKey<Crypto::PublicKey>(map[@"publicKey"], "spendKey.publicKey");
            const auto privateKey = makeNative32ByteKey<Crypto::SecretKey>(map[@"privateKey"], "spendKey.privateKey");

            spendKeys[publicKey] = privateKey;
        }

        return spendKeys;
    }

    NSDictionary *makeJSInput(const Crypto::PublicKey &publicSpendKey, const TransactionInput &input)
    {
        return @{
            @"publicSpendKey": make32ByteKey(publicSpendKey),
            @"input": @{
                @"keyImage": make32ByteKey(input.keyImage),
                @"amount": @(static_cast<double>(input.amount)),
                @"transactionIndex": @(static_cast<double>(input.transactionIndex)),
                @"globalOutputIndex": @(static_cast<double>(input.globalOutputIndex)),
                @"key": make32ByteKey(input.key),
                @"parentTransactionHash": [NSString stringWithUTF8String:input.parentTransactionHash.c_str()],
            },
        };
    }

    /* Run the work off the JS thread (the Java module spawns a thread per
       call) and convert C++ / argument errors into promise rejections. */
    void runAsync(
        RCTPromiseResolveBlock resolve,
        RCTPromiseRejectBlock reject,
        NSString *errorCode,
        id (^work)(void))
    {
        dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
            try
            {
                resolve(work());
            }
            catch (const XTEArgumentError &e)
            {
                reject(errorCode, [NSString stringWithUTF8String:e.message.c_str()], nil);
            }
            catch (const std::exception &e)
            {
                reject(errorCode, [NSString stringWithUTF8String:e.what()], nil);
            }
            catch (...)
            {
                reject(errorCode, @"Unknown native error", nil);
            }
        });
    }
}

@implementation XTEModule

RCT_EXPORT_MODULE(XTE)

+ (BOOL)requiresMainQueueSetup
{
    return NO;
}

RCT_EXPORT_METHOD(generateKeyImage:(NSString *)publicEphemeral
                  privateEphemeral:(NSString *)privateEphemeral
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
    runAsync(resolve, reject, @"generateKeyImage", ^id {
        const auto publicKey = makeNative32ByteKey<Crypto::PublicKey>(publicEphemeral, "publicEphemeral");
        const auto privateKey = makeNative32ByteKey<Crypto::SecretKey>(privateEphemeral, "privateEphemeral");

        Crypto::KeyImage keyImage;
        Crypto::generate_key_image(publicKey, privateKey, keyImage);

        return make32ByteKey(keyImage);
    });
}

RCT_EXPORT_METHOD(deriveSecretKey:(NSString *)derivation
                  outputIndex:(NSDictionary *)outputIndex
                  privateSpendKey:(NSString *)privateSpendKey
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
    runAsync(resolve, reject, @"deriveSecretKey", ^id {
        const auto nativeDerivation = makeNative32ByteKey<Crypto::KeyDerivation>(derivation, "derivation");
        const auto index = toUInt64(requireNumber(requireDictionary(outputIndex, "outputIndex")[@"outputIndex"], "outputIndex"));
        const auto spendKey = makeNative32ByteKey<Crypto::SecretKey>(privateSpendKey, "privateSpendKey");

        Crypto::SecretKey derivedKey;
        Crypto::derive_secret_key(nativeDerivation, index, spendKey, derivedKey);

        return make32ByteKey(derivedKey);
    });
}

RCT_EXPORT_METHOD(derivePublicKey:(NSString *)derivation
                  outputIndex:(NSDictionary *)outputIndex
                  publicSpendKey:(NSString *)publicSpendKey
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
    runAsync(resolve, reject, @"derivePublicKey", ^id {
        const auto nativeDerivation = makeNative32ByteKey<Crypto::KeyDerivation>(derivation, "derivation");
        const auto index = toUInt64(requireNumber(requireDictionary(outputIndex, "outputIndex")[@"outputIndex"], "outputIndex"));
        const auto spendKey = makeNative32ByteKey<Crypto::PublicKey>(publicSpendKey, "publicSpendKey");

        Crypto::PublicKey derivedKey;
        Crypto::derive_public_key(nativeDerivation, index, spendKey, derivedKey);

        return make32ByteKey(derivedKey);
    });
}

RCT_EXPORT_METHOD(generateKeyDerivation:(NSString *)transactionPublicKey
                  privateViewKey:(NSString *)privateViewKey
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
    runAsync(resolve, reject, @"generateKeyDerivation", ^id {
        const auto publicKey = makeNative32ByteKey<Crypto::PublicKey>(transactionPublicKey, "transactionPublicKey");
        const auto viewKey = makeNative32ByteKey<Crypto::SecretKey>(privateViewKey, "privateViewKey");

        Crypto::KeyDerivation derivation;
        Crypto::generate_key_derivation(publicKey, viewKey, derivation);

        return make32ByteKey(derivation);
    });
}

RCT_EXPORT_METHOD(generateRingSignatures:(NSString *)transactionPrefixHash
                  keyImage:(NSString *)keyImage
                  inputKeys:(NSArray *)inputKeys
                  privateKey:(NSString *)privateKey
                  realIndex:(NSDictionary *)realIndex
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
    runAsync(resolve, reject, @"generateRingSignatures", ^id {
        const auto prefixHash = makeNative32ByteKey<Crypto::Hash>(transactionPrefixHash, "transactionPrefixHash");
        const auto nativeKeyImage = makeNative32ByteKey<Crypto::KeyImage>(keyImage, "keyImage");
        const auto publicKeys = makeNativePublicKeys(inputKeys);
        const auto secretKey = makeNative32ByteKey<Crypto::SecretKey>(privateKey, "privateKey");
        const auto index = toUInt64(requireNumber(requireDictionary(realIndex, "realIndex")[@"realIndex"], "realIndex"));

        if (index >= publicKeys.size())
        {
            throw XTEArgumentError{"realIndex is out of range"};
        }

        const auto [success, signatures] = Crypto::generateRingSignatures(
            prefixHash, nativeKeyImage, publicKeys, secretKey, index
        );

        /* Same as Android: the JS side verifies the signatures afterwards. */
        (void)success;

        NSMutableArray *result = [NSMutableArray arrayWithCapacity:signatures.size()];

        for (const auto &signature : signatures)
        {
            [result addObject:make64ByteKey(signature)];
        }

        return result;
    });
}

RCT_EXPORT_METHOD(checkRingSignature:(NSString *)transactionPrefixHash
                  keyImage:(NSString *)keyImage
                  publicKeys:(NSArray *)publicKeys
                  signatures:(NSArray *)signatures
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
    runAsync(resolve, reject, @"checkRingSignature", ^id {
        const auto prefixHash = makeNative32ByteKey<Crypto::Hash>(transactionPrefixHash, "transactionPrefixHash");
        const auto nativeKeyImage = makeNative32ByteKey<Crypto::KeyImage>(keyImage, "keyImage");
        const auto nativePublicKeys = makeNativePublicKeys(publicKeys);
        const auto nativeSignatures = makeNativeSignatures(signatures);

        if (nativePublicKeys.size() != nativeSignatures.size())
        {
            return @NO;
        }

        const bool success = Crypto::checkRingSignature(
            prefixHash, nativeKeyImage, nativePublicKeys, nativeSignatures
        );

        return @(success);
    });
}

RCT_EXPORT_METHOD(processBlockOutputs:(NSDictionary *)block
                  privateViewKey:(NSString *)privateViewKey
                  spendKeys:(NSArray *)spendKeys
                  isViewWallet:(BOOL)isViewWallet
                  processCoinbaseTransactions:(BOOL)processCoinbaseTransactions
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
    runAsync(resolve, reject, @"processBlockOutputs", ^id {
        const auto walletBlockInfo = makeNativeWalletBlockInfo(block);
        const auto viewKey = makeNative32ByteKey<Crypto::SecretKey>(privateViewKey, "privateViewKey");
        const auto nativeSpendKeys = makeNativeSpendKeys(spendKeys);

        const auto inputs = processBlockOutputs(
            walletBlockInfo, viewKey, nativeSpendKeys, isViewWallet, processCoinbaseTransactions
        );

        NSMutableArray *result = [NSMutableArray arrayWithCapacity:inputs.size()];

        for (const auto &[publicSpendKey, input] : inputs)
        {
            [result addObject:makeJSInput(publicSpendKey, input)];
        }

        return result;
    });
}

/* Android battery optimisation ("doze") does not exist on iOS. Resolve with
   values that keep the shared settings screen happy. */
RCT_EXPORT_METHOD(isDozeDisabled:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
    resolve(@YES);
}

RCT_EXPORT_METHOD(navigateToBatteryOptimizationScreen:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
    resolve(@"");
}

@end
