import { Token, BigintIsh, TradeType, Currency } from '@violetprotocol/mauve-sdk-core'
import { Pool, SwapRouter, toHex, Route, encodeRouteToPath } from '@violetprotocol/mauve-v3-sdk'

export const encodeTrade = (
  tradeName: string,
  token0: Token,
  token1: Token,
  pool: Pool,
  recipient: string,
  primaryAmount: BigintIsh,
  secondaryAmount: BigintIsh,
  sqrtPrice?: BigintIsh
) => {
  const sigHash = SwapRouter.INTERFACE.getSighash(tradeName)
  const paddedToken0Address = token0.address.toLowerCase().substring(2).padStart(64, '0')
  const paddedToken1Address = token1.address.toLowerCase().substring(2).padStart(64, '0')
  const paddedFee = pool.fee.toString(16).padStart(64, '0')
  const paddedRecipient = recipient.substring(2).padStart(64, '0')

  // exactOutput/exactInput use this as output/input respectively
  const paddedPrimaryAmount = toHex(primaryAmount).substring(2).padStart(64, '0')

  // the remaining amount is used as secondary
  const paddedSecondaryAmount = toHex(secondaryAmount).substring(2).padStart(64, '0')
  const paddedSqrtPrice = toHex(sqrtPrice ?? 0)
    .substring(2)
    .padStart(64, '0')

  return `${sigHash}${paddedToken0Address}${paddedToken1Address}${paddedFee}${paddedRecipient}${paddedPrimaryAmount}${paddedSecondaryAmount}${paddedSqrtPrice}`
}

export const encodeMultiHopTrade = (
  tradeType: TradeType,
  route: Route<Currency, Currency>,
  recipient: string,
  primaryAmount: BigintIsh,
  minimumSecondaryAmount: BigintIsh
) => {
  const sigHash = SwapRouter.INTERFACE.getSighash(tradeType === TradeType.EXACT_OUTPUT ? 'exactOutput' : 'exactInput')
  const paddedPath = encodeRouteToPath(route, tradeType === TradeType.EXACT_OUTPUT)
    .substring(2)
    .padEnd(192, '0')
  const paddedPathOffset =
    '00000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000080'
  const paddedPathLength = '0000000000000000000000000000000000000000000000000000000000000042'
  const paddedRecipient = recipient.substring(2).padStart(64, '0')

  // the remaining amount is used as secondary
  const paddedPrimaryAmount = toHex(primaryAmount).substring(2).padStart(64, '0')
  const paddedSecondaryAmount = toHex(minimumSecondaryAmount).substring(2).padStart(64, '0')

  return `${sigHash}${paddedPathOffset}${paddedRecipient}${paddedPrimaryAmount}${paddedSecondaryAmount}${paddedPathLength}${paddedPath}`
}
