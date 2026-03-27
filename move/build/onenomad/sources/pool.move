/// Pool module — used by both OneDEX and OneVault logic.
/// Exposes deposit/withdraw matching the PTB signatures in txBuilder.ts.
/// Pool objects have apy_bps and tvl_usd fields read by apyFetcher.ts.
module onenomad::pool {
    use one::object::{Self, UID, ID};
    use one::tx_context::{Self, TxContext};
    use one::transfer;
    use one::coin::{Self, Coin};
    use one::balance::{Self, Balance};
    use one::event;
    use onenomad::position::{Self, Position};

    // ── Events ────────────────────────────────────────────────────────────────

    /// Emitted on every deposit — read by eventMonitor.ts
    public struct DepositEvent has copy, drop {
        pool_id: ID,
        amount: u64,
        depositor: address,
    }

    /// Emitted on every withdraw
    public struct WithdrawEvent has copy, drop {
        pool_id: ID,
        amount: u64,
        recipient: address,
    }

    // ── Pool object ───────────────────────────────────────────────────────────

    /// Generic liquidity pool.
    /// apy_bps and tvl_usd are top-level fields so apyFetcher.ts can read them
    /// directly from object content via getObject({ showContent: true }).
    public struct Pool<phantom CoinA, phantom CoinB> has key {
        id: UID,
        /// APY in basis points — e.g. 850 = 8.50%
        apy_bps: u64,
        /// TVL in whole token units of CoinA (displayed as USD on dashboard)
        tvl_usd: u64,
        reserve_a: Balance<CoinA>,
        reserve_b: Balance<CoinB>,
        total_deposits: u64,
    }

    /// Admin capability — held by deployer to update APY and seed liquidity.
    public struct AdminCap has key { id: UID }

    // ── Initializer ───────────────────────────────────────────────────────────

    fun init(ctx: &mut TxContext) {
        let cap = AdminCap { id: object::new(ctx) };
        transfer::transfer(cap, tx_context::sender(ctx));
    }

    // ── Pool creation ─────────────────────────────────────────────────────────

    /// Create a new shared pool. Called once per pool during setup.
    public fun create_pool<CoinA, CoinB>(
        _cap: &AdminCap,
        apy_bps: u64,
        ctx: &mut TxContext
    ) {
        let pool = Pool<CoinA, CoinB> {
            id: object::new(ctx),
            apy_bps,
            tvl_usd: 0,
            reserve_a: balance::zero(),
            reserve_b: balance::zero(),
            total_deposits: 0,
        };
        transfer::share_object(pool);
    }

    // ── Deposit ───────────────────────────────────────────────────────────────

    /// Deposit CoinA into pool. Updates position tracking.
    /// PTB call: pool::deposit<CoinA, CoinB>(pool, coin, position, ctx)
    public fun deposit<CoinA, CoinB>(
        pool: &mut Pool<CoinA, CoinB>,
        coin: Coin<CoinA>,
        position: &mut Position,
        ctx: &mut TxContext
    ) {
        let amount = coin::value(&coin);
        let pool_id = object::id(pool);

        balance::join(&mut pool.reserve_a, coin::into_balance(coin));
        pool.total_deposits = pool.total_deposits + amount;
        pool.tvl_usd = pool.total_deposits;

        position::add_deposit(position, pool_id, amount);

        event::emit(DepositEvent {
            pool_id,
            amount,
            depositor: tx_context::sender(ctx),
        });
    }

    // ── Withdraw ──────────────────────────────────────────────────────────────

    /// Withdraw amount_percent (0–100) of the position's deposited CoinA.
    /// PTB call: pool::withdraw<CoinA, CoinB>(pool, amount_percent, position, ctx)
    /// Returns Coin<CoinA> which is passed to swap or deposit in the same PTB.
    public fun withdraw<CoinA, CoinB>(
        pool: &mut Pool<CoinA, CoinB>,
        amount_percent: u64,
        position: &mut Position,
        ctx: &mut TxContext
    ): Coin<CoinA> {
        let pool_id = object::id(pool);
        let deposited = position::get_deposit(position, &pool_id);

        assert!(deposited > 0, 0); // nothing deposited

        let withdraw_amount = if (amount_percent >= 100) {
            deposited
        } else {
            deposited * amount_percent / 100
        };

        assert!(withdraw_amount > 0, 1); // percent too small
        assert!(balance::value(&pool.reserve_a) >= withdraw_amount, 2); // insufficient reserve

        position::reduce_deposit(position, pool_id, withdraw_amount);

        pool.total_deposits = if (pool.total_deposits >= withdraw_amount) {
            pool.total_deposits - withdraw_amount
        } else {
            0
        };
        pool.tvl_usd = pool.total_deposits;

        event::emit(WithdrawEvent {
            pool_id,
            amount: withdraw_amount,
            recipient: tx_context::sender(ctx),
        });

        coin::from_balance(balance::split(&mut pool.reserve_a, withdraw_amount), ctx)
    }

    // ── Admin ─────────────────────────────────────────────────────────────────

    /// Update APY — called periodically to reflect real yield rates.
    public fun update_apy<CoinA, CoinB>(
        _cap: &AdminCap,
        pool: &mut Pool<CoinA, CoinB>,
        new_apy_bps: u64,
    ) {
        pool.apy_bps = new_apy_bps;
    }

    /// Seed initial liquidity into the pool for testnet.
    public fun seed_liquidity<CoinA, CoinB>(
        _cap: &AdminCap,
        pool: &mut Pool<CoinA, CoinB>,
        coin_a: Coin<CoinA>,
        coin_b: Coin<CoinB>,
    ) {
        let amount = coin::value(&coin_a);
        balance::join(&mut pool.reserve_a, coin::into_balance(coin_a));
        balance::join(&mut pool.reserve_b, coin::into_balance(coin_b));
        pool.total_deposits = pool.total_deposits + amount;
        pool.tvl_usd = pool.total_deposits;
    }
}
