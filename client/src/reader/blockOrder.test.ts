import { aBlock } from '../test/factories';
import { inReadingOrder } from './blockOrder';

const ids = (blocks: readonly { blockId: bigint }[]) => blocks.map((b) => b.blockId);

describe('inReadingOrder', () => {
  it('orders by author-defined position, not by arrival order', () => {
    const blocks = [
      aBlock({ blockId: 1n, position: 2 }),
      aBlock({ blockId: 2n, position: 0 }),
      aBlock({ blockId: 3n, position: 1 }),
    ];
    expect(ids(inReadingOrder(blocks))).toEqual([2n, 3n, 1n]);
  });

  it('breaks a position tie by block id so the order is stable', () => {
    const blocks = [
      aBlock({ blockId: 9n, position: 0 }),
      aBlock({ blockId: 4n, position: 0 }),
    ];
    expect(ids(inReadingOrder(blocks))).toEqual([4n, 9n]);
  });

  it('does not mutate the subscription rows it was handed', () => {
    const blocks = [
      aBlock({ blockId: 1n, position: 5 }),
      aBlock({ blockId: 2n, position: 1 }),
    ];
    inReadingOrder(blocks);
    expect(ids(blocks)).toEqual([1n, 2n]);
  });

  it('handles an empty chapter', () => {
    expect(inReadingOrder([])).toEqual([]);
  });
});
