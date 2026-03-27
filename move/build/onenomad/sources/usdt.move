module onenomad::usdt {
    use one::coin::{Self, TreasuryCap};
    use one::tx_context::TxContext;
    use one::transfer;
    use std::option;

    public struct USDT has drop {}

    fun init(witness: USDT, ctx: &mut TxContext) {
        let (treasury_cap, metadata) = coin::create_currency<USDT>(
            witness,
            6,
            b"USDT",
            b"Tether USD (Test)",
            b"Test USDT for OneNomad on OneChain testnet",
            option::none(),
            ctx
        );
        transfer::public_freeze_object(metadata);
        transfer::public_share_object(treasury_cap);
    }

    /// Mint test USDT — callable by anyone on testnet
    public fun mint(
        cap: &mut TreasuryCap<USDT>,
        amount: u64,
        ctx: &mut TxContext
    ): coin::Coin<USDT> {
        coin::mint(cap, amount, ctx)
    }

    /// Mint directly to a recipient address
    public fun mint_to(
        cap: &mut TreasuryCap<USDT>,
        amount: u64,
        recipient: address,
        ctx: &mut TxContext
    ) {
        let c = coin::mint(cap, amount, ctx);
        transfer::public_transfer(c, recipient);
    }
}
