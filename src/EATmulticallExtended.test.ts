import { EATMulticallExtended } from './EATmulticallExtended'
import { EATMULTICALL_BLOCKHASH_FUNC_SIG, EATMULTICALL_DEADLINE_FUNC_SIG } from './utils/functionSignatures'

// Create fake signature for encoding
const v = 1
const r = '0xf00d2a7f6996abe9ade2747e3de45e96fb8fe12381ab659586473cb43d7550fb'
const s = '0xf00d2a7f6996abe9ade2747e3de45e96fb8fe12381ab659586473cb43d7550fb'
const expiry = 2

describe('EATMulticallExtended', () => {
  describe('#encodePresignMulticallExtended', () => {
    describe('without validation, works just like EATMulticall', () => {
      it('works for string', async () => {
        const { parameters } = EATMulticallExtended.encodePresignMulticallExtended('0x03')

        expect(parameters).toBe(
          '0x00000000000000000000000000000000000000000000000000000000000000a00000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000010300000000000000000000000000000000000000000000000000000000000000'
        )
      })

      it('works for string array with length 1', async () => {
        const { parameters } = EATMulticallExtended.encodePresignMulticallExtended(['0x03'])
        expect(parameters).toBe(
          '0x00000000000000000000000000000000000000000000000000000000000000a00000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000010300000000000000000000000000000000000000000000000000000000000000'
        )
      })

      it('works for string array with length >1', async () => {
        let { parameters } = EATMulticallExtended.encodePresignMulticallExtended([
          '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        ])
        expect(parameters).toBe(
          '0x00000000000000000000000000000000000000000000000000000000000000a00000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000800000000000000000000000000000000000000000000000000000000000000020aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa0000000000000000000000000000000000000000000000000000000000000020bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
        )
        ;({ parameters } = EATMulticallExtended.encodePresignMulticallExtended([
          '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          '0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
        ]))
        expect(parameters).toBe(
          '0x00000000000000000000000000000000000000000000000000000000000000a00000000000000000000000000000000000000000000000000000000000000003000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000000a000000000000000000000000000000000000000000000000000000000000000e00000000000000000000000000000000000000000000000000000000000000020aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa0000000000000000000000000000000000000000000000000000000000000020bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb0000000000000000000000000000000000000000000000000000000000000020cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'
        )
      })
    })

    describe('with validation', () => {
      // should encode for multicall(uint8,bytes32,bytes32,uint256,uint256,bytes[]) without EAT params
      it('works with deadline as string', () => {
        const { functionSignature, parameters } = EATMulticallExtended.encodePresignMulticallExtended('0x01', '123')
        expect(functionSignature).toEqual(EATMULTICALL_DEADLINE_FUNC_SIG)
        expect(parameters).toBe(
          `0x` +
            `000000000000000000000000000000000000000000000000000000000000007b` +
            `00000000000000000000000000000000000000000000000000000000000000c0` +
            `0000000000000000000000000000000000000000000000000000000000000001` +
            `0000000000000000000000000000000000000000000000000000000000000020` +
            `0000000000000000000000000000000000000000000000000000000000000001` +
            `0100000000000000000000000000000000000000000000000000000000000000`
        )
      })

      // should encode for multicall(uint8,bytes32,bytes32,uint256,uint256,bytes[]) without EAT params
      it('works with deadline as number', () => {
        const { functionSignature, parameters } = EATMulticallExtended.encodePresignMulticallExtended('0x01', 123)
        expect(functionSignature).toEqual(EATMULTICALL_DEADLINE_FUNC_SIG)
        expect(parameters).toBe(
          '0x' +
            `000000000000000000000000000000000000000000000000000000000000007b` +
            `00000000000000000000000000000000000000000000000000000000000000c0` +
            `0000000000000000000000000000000000000000000000000000000000000001` +
            `0000000000000000000000000000000000000000000000000000000000000020` +
            `0000000000000000000000000000000000000000000000000000000000000001` +
            `0100000000000000000000000000000000000000000000000000000000000000`
        )
      })

      // should encode for multicall(uint8,bytes32,bytes32,uint256,bytes32,bytes[]) without EAT params
      it('works with previous block hash', () => {
        const { functionSignature, parameters } = EATMulticallExtended.encodePresignMulticallExtended(
          '0x01',
          '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
        )

        expect(functionSignature).toEqual(EATMULTICALL_BLOCKHASH_FUNC_SIG)
        expect(parameters).toBe(
          '0x' +
            `aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa` +
            `00000000000000000000000000000000000000000000000000000000000000c0` +
            `0000000000000000000000000000000000000000000000000000000000000001` +
            `0000000000000000000000000000000000000000000000000000000000000020` +
            `0000000000000000000000000000000000000000000000000000000000000001` +
            `0100000000000000000000000000000000000000000000000000000000000000`
        )
      })
    })
  })

  describe('#encodePostsignMulticallExtended', () => {
    describe('without validation, works just like EATMulticall', () => {
      it('works for string', async () => {
        const calldata = EATMulticallExtended.encodePostsignMulticallExtended(v, r, s, expiry, '0x03')
        expect(calldata).toBe(
          '0x2efb614b0000000000000000000000000000000000000000000000000000000000000001f00d2a7f6996abe9ade2747e3de45e96fb8fe12381ab659586473cb43d7550fbf00d2a7f6996abe9ade2747e3de45e96fb8fe12381ab659586473cb43d7550fb000000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000a00000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000010300000000000000000000000000000000000000000000000000000000000000'
        )
      })

      it('works for string array with length 1', async () => {
        const calldata = EATMulticallExtended.encodePostsignMulticallExtended(v, r, s, expiry, ['0x03'])
        expect(calldata).toBe(
          '0x2efb614b0000000000000000000000000000000000000000000000000000000000000001f00d2a7f6996abe9ade2747e3de45e96fb8fe12381ab659586473cb43d7550fbf00d2a7f6996abe9ade2747e3de45e96fb8fe12381ab659586473cb43d7550fb000000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000a00000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000010300000000000000000000000000000000000000000000000000000000000000'
        )
      })

      it('works for string array with length >1', async () => {
        let calldata = EATMulticallExtended.encodePostsignMulticallExtended(v, r, s, expiry, [
          '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        ])
        expect(calldata).toBe(
          '0x2efb614b0000000000000000000000000000000000000000000000000000000000000001f00d2a7f6996abe9ade2747e3de45e96fb8fe12381ab659586473cb43d7550fbf00d2a7f6996abe9ade2747e3de45e96fb8fe12381ab659586473cb43d7550fb000000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000a00000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000800000000000000000000000000000000000000000000000000000000000000020aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa0000000000000000000000000000000000000000000000000000000000000020bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
        )

        calldata = EATMulticallExtended.encodePostsignMulticallExtended(v, r, s, expiry, [
          '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          '0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
        ])
        expect(calldata).toBe(
          '0x2efb614b0000000000000000000000000000000000000000000000000000000000000001f00d2a7f6996abe9ade2747e3de45e96fb8fe12381ab659586473cb43d7550fbf00d2a7f6996abe9ade2747e3de45e96fb8fe12381ab659586473cb43d7550fb000000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000a00000000000000000000000000000000000000000000000000000000000000003000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000000a000000000000000000000000000000000000000000000000000000000000000e00000000000000000000000000000000000000000000000000000000000000020aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa0000000000000000000000000000000000000000000000000000000000000020bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb0000000000000000000000000000000000000000000000000000000000000020cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'
        )
      })
    })

    describe('with validation', () => {
      // should encode for multicall(uint8,bytes32,bytes32,uint256,uint256,bytes[])
      it('works with deadline as string', () => {
        const calldata = EATMulticallExtended.encodePostsignMulticallExtended(v, r, s, expiry, '0x01', '123')
        expect(calldata).toBe(
          '0x6cfd42de0000000000000000000000000000000000000000000000000000000000000001f00d2a7f6996abe9ade2747e3de45e96fb8fe12381ab659586473cb43d7550fbf00d2a7f6996abe9ade2747e3de45e96fb8fe12381ab659586473cb43d7550fb0000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000007b00000000000000000000000000000000000000000000000000000000000000c00000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000010100000000000000000000000000000000000000000000000000000000000000'
        )
      })

      // should encode for multicall(uint8,bytes32,bytes32,uint256,uint256,bytes[])
      it('works with deadline as number', () => {
        const calldata = EATMulticallExtended.encodePostsignMulticallExtended(v, r, s, expiry, '0x01', 123)
        expect(calldata).toBe(
          '0x6cfd42de0000000000000000000000000000000000000000000000000000000000000001f00d2a7f6996abe9ade2747e3de45e96fb8fe12381ab659586473cb43d7550fbf00d2a7f6996abe9ade2747e3de45e96fb8fe12381ab659586473cb43d7550fb0000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000007b00000000000000000000000000000000000000000000000000000000000000c00000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000010100000000000000000000000000000000000000000000000000000000000000'
        )
      })

      // should encode for multicall(uint8,bytes32,bytes32,uint256,bytes32,bytes[])
      it('works with previous block hash', () => {
        const calldata = EATMulticallExtended.encodePostsignMulticallExtended(
          v,
          r,
          s,
          expiry,
          '0x01',
          '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
        )
        expect(calldata).toBe(
          '0xb1c41cf40000000000000000000000000000000000000000000000000000000000000001f00d2a7f6996abe9ade2747e3de45e96fb8fe12381ab659586473cb43d7550fbf00d2a7f6996abe9ade2747e3de45e96fb8fe12381ab659586473cb43d7550fb0000000000000000000000000000000000000000000000000000000000000002aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa00000000000000000000000000000000000000000000000000000000000000c00000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000010100000000000000000000000000000000000000000000000000000000000000'
        )
      })
    })
  })
})
