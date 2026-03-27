module onenomad::position {
    use one::object::{Self, UID, ID};
    use one::tx_context::{Self, TxContext};
    use one::transfer;
    use one::vec_map::{Self, VecMap};

    /// Tracks the agent's deposited amount per pool.
    /// Shared object — passed into every deposit/withdraw call.
    public struct Position has key, store {
        id: UID,
        owner: address,
        /// pool_id -> amount of CoinA deposited
        deposits: VecMap<ID, u64>,
    }

    /// Create and share a Position object on-chain.
    /// Call this once during setup to get the POSITION_OBJECT_ID.
    public fun create_shared(ctx: &mut TxContext) {
        let pos = Position {
            id: object::new(ctx),
            owner: tx_context::sender(ctx),
            deposits: vec_map::empty(),
        };
        transfer::share_object(pos);
    }

    /// Returns how much CoinA is tracked for a given pool.
    public fun get_deposit(pos: &Position, pool_id: &ID): u64 {
        if (vec_map::contains(&pos.deposits, pool_id)) {
            *vec_map::get(&pos.deposits, pool_id)
        } else {
            0
        }
    }

    /// Add to tracked deposit — only callable within this package.
    public(package) fun add_deposit(pos: &mut Position, pool_id: ID, amount: u64) {
        if (vec_map::contains(&pos.deposits, &pool_id)) {
            let current = vec_map::get_mut(&mut pos.deposits, &pool_id);
            *current = *current + amount;
        } else {
            vec_map::insert(&mut pos.deposits, pool_id, amount);
        }
    }

    /// Reduce tracked deposit — only callable within this package.
    public(package) fun reduce_deposit(pos: &mut Position, pool_id: ID, amount: u64) {
        if (vec_map::contains(&pos.deposits, &pool_id)) {
            let current = vec_map::get_mut(&mut pos.deposits, &pool_id);
            if (*current <= amount) {
                vec_map::remove(&mut pos.deposits, &pool_id);
            } else {
                *current = *current - amount;
            }
        }
    }
}
