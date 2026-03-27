module onenomad::usdc {
    use one::coin::{Self, TreasuryCap};
    use one::tx_context::TxContext;
    use one::transfer;
    use std::option;

    public struct USDC has drop {}

    fun init(witness: USDC, ctx: &mut TxContext) {
        let (treasury_cap, metadata) = coin::create_currency<USDC>(
            witness,
            6,
            b"USDC",
            b"USD Coin (Test)",
            b"Test USDC for OneNomad on OneChain testnet",
            option::none(),
            ctx
        );
        transfer::public_freeze_object(metadata);
        transfer::public_share_object(treasury_cap);
    }

    /// Mint test USDC — callable by anyone on testnet
    public fun mint(
        cap: &mut TreasuryCap<USDC>,
        amount: u64,
        ctx: &mut TxContext
    ): coin::Coin<USDC> {
        coin::mint(cap, amount, ctx)
    }

    /// Mint directly to a recipient address
    public fun mint_to(
        cap: &mut TreasuryCap<USDC>,
        amount: u64,
        recipient: address,
        ctx: &mut TxContext
    ) {
        let c = coin::mint(cap, amount, ctx);
        transfer::public_transfer(c, recipient);
    }
}
