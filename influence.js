/**
 * Influence model.
 *
 * Nothing here is persisted. Every number on the influence page is derived
 * from the saved history entries in localStorage each time the page loads.
 *
 * The model has two halves:
 *
 *   1. SCORING  - in each election year a country earns points for every role
 *                 it holds that year (head of government, crown, cabinet
 *                 portfolios, committee chairs, coalition membership, raw
 *                 parliamentary weight).
 *
 *   2. DECAY    - influence is a legacy, not a snapshot. Points earned in a
 *                 given year keep counting in later years, multiplied by
 *                 DECAY once per election cycle, so old glory fades but never
 *                 quite disappears.
 *
 *        influence(country, Y) = SUM over cycles y <= Y of
 *                                score(country, y) * DECAY^(Y - y)
 *
 * The WEIGHTS below are the single source of truth: the documentation panel
 * on influence.html is rendered from this same object, so the published
 * weights can never drift away from the arithmetic.
 */
const InfluenceModel = (function () {
    'use strict';

    /** Retention factor applied once per election cycle (one saved year). */
    const DECAY = 0.75;

    /** Points awarded for holding a role for one election cycle. */
    const WEIGHTS = {
        primeMinister:          100,
        majorityPmBonus:         15,
        king:                    45,
        queen:                   35,
        oppositionLeader:        30,
        minister:                12,
        committee:                8,
        coalitionMember:         20,
        coalitionMajorityBonus:   5,
        seatShare:               40,
        qualified:                5
    };

    /** Display names for the docs panel, keyed by WEIGHTS field. */
    const WEIGHT_LABELS = {
        primeMinister:          'Prime Minister',
        majorityPmBonus:        'Majority PM bonus',
        king:                   'King',
        queen:                  'Queen',
        oppositionLeader:       'Opposition Leader',
        minister:               'Cabinet minister',
        committee:              'Committee chair',
        coalitionMember:        'Coalition member',
        coalitionMajorityBonus: 'Coalition majority bonus',
        seatShare:              'Seat share',
        qualified:              'Seat in parliament'
    };

    /** Human-readable notes, keyed by WEIGHTS field. Used by the docs panel. */
    const WEIGHT_NOTES = {
        primeMinister:          'Head of government. The single most valuable office in the model.',
        majorityPmBonus:        'Added to the Prime Minister when the coalition actually commands a majority.',
        king:                   'The crown. Ceremonial, but permanent visibility.',
        queen:                  'The consort, weighted just below the crown.',
        oppositionLeader:       'Leader of the largest party outside government.',
        minister:               'Per cabinet seat, before the portfolio multiplier. The PM seat is not counted twice.',
        committee:              'Per committee chair, before the committee multiplier.',
        coalitionMember:        'Flat award for sitting in government at all.',
        coalitionMajorityBonus: 'Added per coalition member when the coalition holds a majority.',
        seatShare:              'Multiplied by the share of parliament held, so raw size always counts.',
        qualified:              'Flat award for clearing the threshold and entering parliament.'
    };

    /**
     * Great offices of state are worth more than the rest of the cabinet.
     * Any portfolio not listed uses 1.0.
     */
    const PORTFOLIO_MULTIPLIERS = {
        'Finance':          1.6,
        'Foreign Affairs':  1.5,
        'Interior':         1.4,
        'Defense':          1.4,
        'Justice':          1.2,
        'Economy':          1.2
    };

    /** Likewise for the committees that actually control money and security. */
    const COMMITTEE_MULTIPLIERS = {
        'Budget & Finance':       1.6,
        'Foreign Affairs':        1.5,
        'Defense & Security':     1.4,
        'Constitutional & Legal': 1.3,
        'Economic Affairs':       1.2
    };

    /**
     * Cabinet portfolios in allocation order, excluding the Prime Minister.
     * Must stay in step with ministers-stats.html so both pages reconstruct
     * the same cabinet from the stored per-party minister counts.
     */
    const MINISTER_TITLES = [
        'Finance', 'Foreign Affairs', 'Interior', 'Defense',
        'Justice', 'Health', 'Education', 'Economy', 'Labor',
        'Environment', 'Transport', 'Agriculture', 'Culture', 'Energy'
    ];

    /** The five political positions, ordered left to right. */
    const WINGS = ['Hard Left Wing', 'Left Wing', 'Middle', 'Right Wing', 'Hard Right Wing'];

    /** Look up a party record by name within one history entry. */
    function findParty(entry, partyName) {
        if (!partyName || !entry.qualifiedParties) return null;
        return entry.qualifiedParties.find(p => p.name === partyName) || null;
    }

    /**
     * The same scoring can be tallied per country or per political wing.
     * A dimension just says how to name the holder of a role; everything
     * else about the model is identical.
     */
    const DIMENSIONS = {
        country: {
            key: 'country',
            label: 'country',
            ofParty: party => (party && party.realCountry) || null,
            ofCommittee: (entry, committee) => {
                const party = findParty(entry, committee.partyName);
                return (party && party.realCountry) || null;
            },
            ofRoyal: (entry, royal) => {
                if (!royal) return null;
                if (royal.realCountry) return royal.realCountry;
                const party = findParty(entry, royal.country);
                return (party && party.realCountry) || null;
            },
            order: null
        },
        wing: {
            key: 'wing',
            label: 'political wing',
            ofParty: party => (party && party.position) || null,
            ofCommittee: (entry, committee) => {
                if (committee.partyPosition) return committee.partyPosition;
                const party = findParty(entry, committee.partyName);
                return (party && party.position) || null;
            },
            ofRoyal: (entry, royal) => {
                if (!royal) return null;
                if (royal.position) return royal.position;
                const party = findParty(entry, royal.country);
                return (party && party.position) || null;
            },
            order: WINGS
        }
    };

    function resolveDimension(name) {
        return DIMENSIONS[name] || DIMENSIONS.country;
    }

    /**
     * Score a single history entry.
     *
     * Returns { country: { total, items: [{ label, points, detail }] } }.
     * The itemised breakdown is what the page shows when you drill into a
     * year, so every point on the graph can be traced back to a role.
     */
    function scoreYear(entry, dimensionName) {
        const dim = resolveDimension(dimensionName);
        const scores = {};
        const seats = entry.parliamentSeats || 200;

        function award(holder, label, points, detail) {
            if (!holder || !points) return;
            if (!scores[holder]) scores[holder] = { total: 0, items: [] };
            scores[holder].total += points;
            scores[holder].items.push({
                label: label,
                points: points,
                detail: detail || null
            });
        }

        // --- Parliament: presence and raw size -----------------------------
        (entry.qualifiedParties || []).forEach(party => {
            const holder = dim.ofParty(party);
            if (!holder) return;
            award(holder, 'In parliament', WEIGHTS.qualified);
            const share = seats > 0 ? (party.seats || 0) / seats : 0;
            award(
                holder,
                'Seat share',
                WEIGHTS.seatShare * share,
                `${party.seats || 0} of ${seats} seats (${(share * 100).toFixed(1)}%)`
            );
        });

        // --- Government ----------------------------------------------------
        const hasMajority = !!entry.hasMajority;

        (entry.coalitionParties || []).forEach(party => {
            const holder = dim.ofParty(party);
            if (!holder) return;
            award(holder, 'In coalition', WEIGHTS.coalitionMember);
            if (hasMajority) {
                award(holder, 'Majority coalition', WEIGHTS.coalitionMajorityBonus);
            }
        });

        const pmHolder = dim.ofParty(entry.primeMinister);
        if (pmHolder) {
            award(pmHolder, 'Prime Minister', WEIGHTS.primeMinister);
            if (hasMajority) {
                award(pmHolder, 'Majority government', WEIGHTS.majorityPmBonus);
            }
        }

        // --- Cabinet -------------------------------------------------------
        // governmentMinisters stores a per-party count, already sorted by
        // seats. Walk the portfolio list in that order to recover who held
        // which office, so the great offices can be weighted individually.
        if (entry.governmentMinisters && entry.governmentMinisters.length > 0) {
            const pmPartyName = entry.primeMinister ? entry.primeMinister.name : null;
            let titleIndex = 0;

            entry.governmentMinisters.forEach(party => {
                const isPmParty = pmPartyName && party.name === pmPartyName;
                const toAssign = isPmParty ? (party.ministers || 0) - 1 : (party.ministers || 0);

                for (let i = 0; i < toAssign && titleIndex < MINISTER_TITLES.length; i++) {
                    const title = MINISTER_TITLES[titleIndex];
                    const multiplier = PORTFOLIO_MULTIPLIERS[title] || 1;
                    award(
                        dim.ofParty(party),
                        `Minister of ${title}`,
                        WEIGHTS.minister * multiplier,
                        multiplier !== 1 ? `great office (x${multiplier})` : null
                    );
                    titleIndex++;
                }
            });
        }

        // --- Committees ----------------------------------------------------
        (entry.committees || []).forEach(committee => {
            const holder = dim.ofCommittee(entry, committee);
            const multiplier = COMMITTEE_MULTIPLIERS[committee.committeeName] || 1;
            award(
                holder,
                `Chair: ${committee.committeeName}`,
                WEIGHTS.committee * multiplier,
                multiplier !== 1 ? `key committee (x${multiplier})` : null
            );
        });

        // --- Opposition ----------------------------------------------------
        const oppositionHolder = dim.ofParty(entry.oppositionLeader);
        if (oppositionHolder) {
            award(oppositionHolder, 'Opposition Leader', WEIGHTS.oppositionLeader);
        }

        // --- Crown ---------------------------------------------------------
        award(dim.ofRoyal(entry, entry.king), 'King', WEIGHTS.king);
        award(dim.ofRoyal(entry, entry.queen), 'Queen', WEIGHTS.queen);

        return scores;
    }

    /**
     * Build the full influence timeline from a history array.
     *
     * @param {Array}  history          saved history entries
     * @param {Object} [options]
     * @param {number} [options.decay]  override the retention factor
     * @returns {{
     *   years: number[],
     *   countries: string[],
     *   series: Object,        // country -> influence value per year
     *   earned: Object,        // country -> points earned per year (no decay)
     *   yearScores: Array,     // per-year itemised scores
     *   decay: number
     * }}
     */
    function computeTimeline(history, options) {
        const opts = options || {};
        const decay = typeof opts.decay === 'number' ? opts.decay : DECAY;

        const dim = resolveDimension(opts.dimension);

        const entries = (history || []).slice().sort((a, b) => (a.year || 0) - (b.year || 0));
        const years = entries.map(e => e.year || 0);
        const yearScores = entries.map(entry => scoreYear(entry, dim.key));

        const countrySet = new Set();
        yearScores.forEach(scores => Object.keys(scores).forEach(c => countrySet.add(c)));

        // Wings keep their left-to-right order; countries sort alphabetically.
        const countries = dim.order
            ? dim.order.filter(name => countrySet.has(name))
                .concat(Array.from(countrySet).filter(n => dim.order.indexOf(n) === -1).sort())
            : Array.from(countrySet).sort();

        const series = {};
        const earned = {};
        countries.forEach(country => {
            series[country] = [];
            earned[country] = [];
        });

        // influence(Y) = sum over y <= Y of score(y) * decay^(Y - y)
        // Computed incrementally: carry forward the running total, decayed.
        const running = {};
        countries.forEach(c => { running[c] = 0; });

        for (let i = 0; i < entries.length; i++) {
            countries.forEach(country => {
                const gained = yearScores[i][country] ? yearScores[i][country].total : 0;
                running[country] = running[country] * decay + gained;
                series[country].push(running[country]);
                earned[country].push(gained);
            });
        }

        return {
            years: years,
            countries: countries,
            series: series,
            earned: earned,
            yearScores: yearScores,
            decay: decay,
            dimension: dim.key
        };
    }

    /**
     * Machine-readable description of the model, used to render the
     * documentation panel so it always matches the code above.
     */
    function describe() {
        return {
            decay: DECAY,
            halfLifeCycles: Math.log(0.5) / Math.log(DECAY),
            weights: Object.keys(WEIGHTS).map(key => ({
                key: key,
                label: WEIGHT_LABELS[key] || key,
                points: WEIGHTS[key],
                note: WEIGHT_NOTES[key] || ''
            })),
            portfolioMultipliers: PORTFOLIO_MULTIPLIERS,
            committeeMultipliers: COMMITTEE_MULTIPLIERS,
            ministerTitles: MINISTER_TITLES
        };
    }

    return {
        DECAY: DECAY,
        WEIGHTS: WEIGHTS,
        PORTFOLIO_MULTIPLIERS: PORTFOLIO_MULTIPLIERS,
        COMMITTEE_MULTIPLIERS: COMMITTEE_MULTIPLIERS,
        MINISTER_TITLES: MINISTER_TITLES,
        WINGS: WINGS,
        scoreYear: scoreYear,
        computeTimeline: computeTimeline,
        describe: describe
    };
})();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = InfluenceModel;
}
