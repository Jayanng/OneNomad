/// Swap module — handles token swaps between pools.
/// Called by txBuilder.ts when source and target pools use different token pairs.
module onenomad::swap {
    use one::object::{Self, UID, ID};
    use one::tx_context::{Self, TxContext};
    use one::transfer;
    use one::coin::{Self, Coin};
    use one::balance::{Self, Balance};
    use one::event;

    // ── Events ────────────────────────────────────────────────────────────────

    /// Emitted on every swap — fields read by eventMonitor.ts formatEvent()
    public struct SwapEvent has copy, drop {
        pool_id: ID,
        amount_in: u64,
        amount_out: u64,
        trader: address,
    }

    // ── Swap pool ─────────────────────────────────────────────────────────────

    public struct SwapPool<phantom CoinIn, phantom CoinOut> has key {
        id: UID,
        reserve_in: Balance<CoinIn>,
        reserve_out: Balance<CoinOut>,
        /// Fee in basis points — e.g. 30 = 0.30%
        fee_bps: u64,
    }

    /// Admin capability for swap pool management.
    public struct SwapAdminCap has key { id: UID }

    // ── Initializer ───────────────────────────────────────────────────────────

    fun init(ctx: &mut TxContext) {
        let cap = SwapAdminCap { id: object::new(ctx) };
        transfer::transfer(cap, tx_context::sender(ctx));
    }

    // ── Pool creation ─────────────────────────────────────────────────────────

    /// Create a new shared swap pool. Called once per pair during setup.
    public fun create_swap_pool<CoinIn, CoinOut>(
        _cap: &SwapAdminCap,
        fee_bps: u64,
        ctx: &mut TxContext
    ) {
        let pool = SwapPool<CoinIn, CoinOut> {
            id: object::new(ctx),
            reserve_in: balance::zero(),
            reserve_out: balance::zero(),
            fee_bps,
        };
        transfer::share_object(pool);
    }

    /// Seed the swap pool with output tokens so swaps can execute on testnet.
    public fun seed_swap_pool<CoinIn, CoinOut>(
        _cap: &SwapAdminCap,
        pool: &mut SwapPool<CoinIn, CoinOut>,
        coin_out: Coin<CoinOut>,
    ) {
        balance::join(&mut pool.reserve_out, coin::into_balance(coin_out));
    }

    // ── Swap ──────────────────────────────────────────────────────────────────

    /// Swap exact CoinIn amount for CoinOut.
    /// PTB call: swap::swap_exact_input<CoinIn, CoinOut>(pool, coin, min_amount_out, ctx)
    /// Uses a simple constant-rate swap (amount_out = amount_in - fee) for testnet.
    public fun swap_exact_input<CoinIn, CoinOut>(
        pool: &mut SwapPool<CoinIn, CoinOut>,
        coin_in: Coin<CoinIn>,
        min_amount_out: u64,
        ctx: &mut TxContext
    ): Coin<CoinOut> {
        let amount_in = coin::value(&coin_in);
        let fee = amount_in * pool.fee_bps / 10_000;
        let amount_out = amount_in - fee;

        assert!(amount_out >= min_amount_out, 0); // slippage check
        assert!(balance::value(&pool.reserve_out) >= amount_out, 1); // insufficient output reserve

        balance::join(&mut pool.reserve_in, coin::into_balance(coin_in));

        event::emit(SwapEvent {
            pool_id: object::id(pool),
            amount_in,
            amount_out,
            trader: tx_context::sender(ctx),
        });

        coin::from_balance(balance::split(&mut pool.reserve_out, amount_out), ctx)
    }
}
