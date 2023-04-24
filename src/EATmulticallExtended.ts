import { Interface } from '@ethersproject/abi'
import { abi } from '@violetprotocol/mauve-swap-router-contracts/artifacts/contracts/interfaces/IEATMulticallExtended.sol/IEATMulticallExtended.json'
import { EATMulticall, PresignEATFunctionCall, toHex } from '@violetprotocol/mauve-v3-sdk'
import { utils } from '@violetprotocol/ethereum-access-token-helpers'
import { Validation } from './multicallExtended'

function validateAndParseBytes32(bytes32: string): string {
  if (!bytes32.match(/^0x[0-9a-fA-F]{64}$/)) {
    throw new Error(`${bytes32} is not valid bytes32.`)
  }

  return bytes32.toLowerCase()
}

export abstract class EATMulticallExtended {
  public static INTERFACE: Interface = new Interface(abi)

  /**
   * Cannot be constructed.
   */
  private constructor() {}

  public static encodePostsignMulticallExtended(
    v: number,
    r: string,
    s: string,
    expiry: number,
    calldatas: string | string[],
    validation?: Validation
  ): string {
    // if there's no validation, we can just fall back to regular multicall
    if (typeof validation === 'undefined') {
      return EATMulticall.encodePostsignMulticall(v, r, s, expiry, calldatas)
    }

    // if there is validation, we have to normalize calldatas
    if (!Array.isArray(calldatas)) {
      calldatas = [calldatas]
    }

    // this means the validation value should be a previousBlockhash
    if (typeof validation === 'string' && validation.startsWith('0x')) {
      const previousBlockhash = validateAndParseBytes32(validation)

      return EATMulticallExtended.INTERFACE.encodeFunctionData(
        'multicall(uint8,bytes32,bytes32,uint256,bytes32,bytes[])',
        [v, r, s, expiry, previousBlockhash, calldatas]
      )
    } else {
      const deadline = toHex(validation)

      return EATMulticallExtended.INTERFACE.encodeFunctionData(
        'multicall(uint8,bytes32,bytes32,uint256,uint256,bytes[])',
        [v, r, s, expiry, deadline, calldatas]
      )
    }
  }

  public static encodePresignMulticallExtended(
    calldatas: string | string[],
    validation?: Validation
  ): PresignEATFunctionCall {
    // if there's no validation, we can just fall back to regular multicall
    if (typeof validation === 'undefined') {
      return EATMulticall.encodePresignMulticall(calldatas)
    }

    // if there is validation, we have to normalize calldatas
    if (!Array.isArray(calldatas)) {
      calldatas = [calldatas]
    }

    // this means the validation value should be a previousBlockhash
    if (typeof validation === 'string' && validation.startsWith('0x')) {
      const previousBlockhash = validateAndParseBytes32(validation)
      return {
        functionSignature: EATMulticallExtended.INTERFACE.getSighash(
          'multicall(uint8,bytes32,bytes32,uint256,bytes32,bytes[])'
        ),
        parameters: utils.packParameters(
          EATMulticallExtended.INTERFACE,
          'multicall(uint8,bytes32,bytes32,uint256,bytes32,bytes[])',
          [previousBlockhash, calldatas]
        ),
      }
    } else {
      const deadline = toHex(validation)
      return {
        functionSignature: EATMulticallExtended.INTERFACE.getSighash(
          'multicall(uint8,bytes32,bytes32,uint256,uint256,bytes[])'
        ),
        parameters: utils.packParameters(
          EATMulticallExtended.INTERFACE,
          'multicall(uint8,bytes32,bytes32,uint256,uint256,bytes[])',
          [deadline, calldatas]
        ),
      }
    }
  }
}
