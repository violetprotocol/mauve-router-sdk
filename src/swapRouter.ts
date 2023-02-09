import { Interface } from '@ethersproject/abi'
import { Currency, CurrencyAmount, Percent, TradeType, validateAndParseAddress, WETH9 } from '@uniswap/sdk-core'
import { abi } from '@violetprotocol/swap-router-contracts/artifacts/contracts/interfaces/ISwapRouter02.sol/ISwapRouter02.json'
import { Trade as V2Trade } from '@uniswap/v2-sdk'
import {
  encodeRouteToPath,
  FeeOptions,
  MethodParameters,
  Payments,
  PermitOptions,
  Pool,
  Position,
  Route,
  SelfPermit,
  toHex,
  Trade as V3Trade,
} from '@uniswap/v3-sdk'
import invariant from 'tiny-invariant'
import JSBI from 'jsbi'
import { utils } from '@violetprotocol/ethereum-access-token-helpers'
import { ADDRESS_THIS, MSG_SENDER } from './constants'
import { ApproveAndCall, ApprovalTypes, CondensedAddLiquidityOptions } from './approveAndCall'
import { Trade } from './entities/trade'
import { Protocol } from './entities/protocol'
import { MixedRoute, RouteV2, RouteV3 } from './entities/route'
import { MulticallExtended, Validation } from './multicallExtended'
import { PaymentsExtended } from './paymentsExtended'
import { MixedRouteTrade } from './entities/mixedRoute/trade'
import { encodeMixedRouteToPath } from './utils/encodeMixedRouteToPath'
import { MixedRouteSDK } from './entities/mixedRoute/route'
import { partitionMixedRouteByProtocol, getOutputOfPools } from './utils'

const ZERO = JSBI.BigInt(0)
const REFUND_ETH_PRICE_IMPACT_THRESHOLD = new Percent(JSBI.BigInt(50), JSBI.BigInt(100))

type TxAuthResponse = string

export interface TxAuthRequest {
  functionName: string
  functionSignature: string
  packedParams: string
  targetContract: string
}

export interface MultiTxAuthRequest {
  from: string
  txAuthRequestArray: TxAuthRequest[]
}

export const fetchEats = (multiTxAuthRequest: MultiTxAuthRequest): Promise<EthereumAccessToken[]> => {
  const baseApiUrl = 'http://localhost:8080/api/authz/swap'
  const headers = new Headers({ 'Content-Type': 'application/json' })
  const eatArray = fetch(baseApiUrl, {
    method: 'GET',
    headers,
    body: JSON.stringify(multiTxAuthRequest),
  })
    .then((res) => res.json())
    .then((data) => {
      return data.map((eat: string) => {
        const decodedEAT = JSON.parse(atob(eat))
        return { ...splitSignature(decodedEAT.signature), expiry: parseInt(decodedEAT.expiry, 10) }
      })
    })
    .catch((e) => alert(e.message))
  return eatArray
}

export interface Signature {
  v: number
  r: string
  s: string
}

export interface EthereumAccessToken extends Signature {
  expiry: number
}

// Splits the Ethereum Access Token received into V, R and S that is necessary when calling the contract
// function the requires an authorization token
export const splitSignature = (signature: string): Signature => {
  return {
    v: parseInt(signature.substring(130, 132), 16),
    r: '0x' + signature.substring(2, 66),
    s: '0x' + signature.substring(66, 130),
  }
}

/**
 * Options for producing the arguments to send calls to the router.
 */
export interface SwapOptions {
  /**
   * How much the execution price is allowed to move unfavorably from the trade execution price.
   */
  slippageTolerance: Percent

  /**
   * The account that should receive the output. If omitted, output is sent to msg.sender.
   */
  recipient?: string

  /**
   * Either deadline (when the transaction expires, in epoch seconds), or previousBlockhash.
   */
  deadlineOrPreviousBlockhash?: Validation

  /**
   * The optional permit parameters for spending the input.
   */
  inputTokenPermit?: PermitOptions

  /**
   * Optional information for taking a fee on output.
   */
  fee?: FeeOptions

  swapRouterAddress?: string

  sender?: string
}

export interface SwapAndAddOptions extends SwapOptions {
  /**
   * The optional permit parameters for pulling in remaining output token.
   */
  outputTokenPermit?: PermitOptions
}

type AnyTradeType =
  | Trade<Currency, Currency, TradeType>
  | V2Trade<Currency, Currency, TradeType>
  | V3Trade<Currency, Currency, TradeType>
  | MixedRouteTrade<Currency, Currency, TradeType>
  | (
      | V2Trade<Currency, Currency, TradeType>
      | V3Trade<Currency, Currency, TradeType>
      | MixedRouteTrade<Currency, Currency, TradeType>
    )[]

/**
 * Represents the Uniswap V2 + V3 SwapRouter02, and has static methods for helping execute trades.
 */
export abstract class SwapRouter {
  public static INTERFACE: Interface = new Interface(abi)

  /**
   * Cannot be constructed.
   */
  private constructor() {}

  private static getPackedParams(functionName: string, rawParams: any[]): string {
    return utils.packParameters(SwapRouter.INTERFACE, functionName, rawParams)
  }

  /**
   * @notice Generates the calldata for a Swap with a V2 Route.
   * @param trade The V2Trade to encode.
   * @param options SwapOptions to use for the trade.
   * @param routerMustCustody Flag for whether funds should be sent to the router
   * @param performAggregatedSlippageCheck Flag for whether we want to perform an aggregated slippage check
   * @returns A string array of calldatas for the trade.
   */
  private static encodeV2Swap(
    trade: V2Trade<Currency, Currency, TradeType>,
    options: SwapOptions,
    routerMustCustody: boolean,
    performAggregatedSlippageCheck: boolean
  ): string {
    const amountIn: string = toHex(trade.maximumAmountIn(options.slippageTolerance).quotient)
    const amountOut: string = toHex(trade.minimumAmountOut(options.slippageTolerance).quotient)

    const path = trade.route.path.map((token) => token.address)
    const recipient = routerMustCustody
      ? ADDRESS_THIS
      : typeof options.recipient === 'undefined'
      ? MSG_SENDER
      : validateAndParseAddress(options.recipient)

    if (trade.tradeType === TradeType.EXACT_INPUT) {
      const exactInputParams = [amountIn, performAggregatedSlippageCheck ? 0 : amountOut, path, recipient]

      return SwapRouter.INTERFACE.encodeFunctionData('swapExactTokensForTokens', exactInputParams)
    } else {
      const exactOutputParams = [amountOut, amountIn, path, recipient]

      return SwapRouter.INTERFACE.encodeFunctionData('swapTokensForExactTokens', exactOutputParams)
    }
  }

  private static constructSwap(functionName: string, params: any[], targetContract: string, EAT?: EthereumAccessToken) {
    if (EAT != undefined) {
      return SwapRouter.INTERFACE.encodeFunctionData(functionName, [EAT.v, EAT.r, EAT.s, EAT.expiry, ...params])
    }

    const packedParams = this.getPackedParams(functionName, params)
    const functionSignature = SwapRouter.INTERFACE.getSighash(functionName)

    return {
      functionName,
      functionSignature,
      packedParams,
      targetContract,
    }
  }

  private static constructSwaps(
    trade: V3Trade<Currency, Currency, TradeType>,
    options: SwapOptions,
    routerMustCustody: boolean,
    performAggregatedSlippageCheck: boolean,
    EATs?: EthereumAccessToken[]
  ): TxAuthRequest[] | TxAuthResponse[] {
    const { swapRouterAddress: targetContract } = options

    if (!targetContract) {
      throw new Error('Missing Swap Router Address')
    }

    const txAuthRequestArray: TxAuthRequest[] = []
    const txAuthResponseArray: TxAuthResponse[] = []

    trade.swaps.forEach(({ route, inputAmount, outputAmount }, index) => {
      const amountIn: string = toHex(trade.maximumAmountIn(options.slippageTolerance, inputAmount).quotient)
      const amountOut: string = toHex(trade.minimumAmountOut(options.slippageTolerance, outputAmount).quotient)

      // flag for whether the trade is single hop or not
      const singleHop = route.pools.length === 1

      const recipient = routerMustCustody
        ? ADDRESS_THIS
        : typeof options.recipient === 'undefined'
        ? MSG_SENDER
        : validateAndParseAddress(options.recipient)

      if (singleHop) {
        if (trade.tradeType === TradeType.EXACT_INPUT) {
          const exactInputSingleParams = {
            tokenIn: route.tokenPath[0].address,
            tokenOut: route.tokenPath[1].address,
            fee: route.pools[0].fee,
            recipient,
            amountIn,
            amountOutMinimum: performAggregatedSlippageCheck ? 0 : amountOut,
            sqrtPriceLimitX96: 0,
          }

          if (EATs != undefined) {
            const txAuthResponse = <TxAuthResponse>(
              this.constructSwap('exactInputSingle', Object.values(exactInputSingleParams), targetContract, EATs[index])
            )

            txAuthResponseArray.push(txAuthResponse)
          } else {
            const txAuthRequest = <TxAuthRequest>(
              this.constructSwap('exactInputSingle', Object.values(exactInputSingleParams), targetContract)
            )

            txAuthRequestArray.push(txAuthRequest)
          }
        } else {
          const exactOutputSingleParams = {
            tokenIn: route.tokenPath[0].address,
            tokenOut: route.tokenPath[1].address,
            fee: route.pools[0].fee,
            recipient,
            amountOut,
            amountInMaximum: amountIn,
            sqrtPriceLimitX96: 0,
          }
          if (EATs != undefined) {
            const txAuthResponse = <TxAuthResponse>(
              this.constructSwap(
                'exactOutputSingle',
                Object.values(exactOutputSingleParams),
                targetContract,
                EATs[index]
              )
            )

            txAuthResponseArray.push(txAuthResponse)
          } else {
            const txAuthRequest = <TxAuthRequest>(
              this.constructSwap('exactOutputSingle', Object.values(exactOutputSingleParams), targetContract)
            )

            txAuthRequestArray.push(txAuthRequest)
          }
        }
      } else {
        const path: string = encodeRouteToPath(route, trade.tradeType === TradeType.EXACT_OUTPUT)

        if (trade.tradeType === TradeType.EXACT_INPUT) {
          const exactInputParams = {
            path,
            recipient,
            amountIn,
            amountOutMinimum: performAggregatedSlippageCheck ? 0 : amountOut,
          }
          if (EATs != undefined) {
            const txAuthResponse = <TxAuthResponse>(
              this.constructSwap('exactInput', Object.values(exactInputParams), targetContract, EATs[index])
            )

            txAuthResponseArray.push(txAuthResponse)
          } else {
            const txAuthRequest = <TxAuthRequest>(
              this.constructSwap('exactInput', Object.values(exactInputParams), targetContract)
            )

            txAuthRequestArray.push(txAuthRequest)
          }
        } else {
          const exactOutputParams = {
            path,
            recipient,
            amountOut,
            amountInMaximum: amountIn,
          }
          if (EATs != undefined) {
            const txAuthResponse = <TxAuthResponse>(
              this.constructSwap('exactOutput', Object.values(exactOutputParams), targetContract, EATs[index])
            )

            txAuthResponseArray.push(txAuthResponse)
          } else {
            const txAuthRequest = <TxAuthRequest>(
              this.constructSwap('exactOutput', Object.values(exactOutputParams), targetContract)
            )

            txAuthRequestArray.push(txAuthRequest)
          }
        }
      }
    })

    return EATs != undefined ? txAuthResponseArray : txAuthRequestArray
  }

  /**
   * @notice Generates the calldata for a Swap with a V3 Route.
   * @param trade The V3Trade to encode.
   * @param options SwapOptions to use for the trade.
   * @param routerMustCustody Flag for whether funds should be sent to the router
   * @param performAggregatedSlippageCheck Flag for whether we want to perform an aggregated slippage check
   * @returns A string array of calldatas for the trade.
   */
  private static async encodeV3Swap(
    trade: V3Trade<Currency, Currency, TradeType>,
    options: SwapOptions,
    routerMustCustody: boolean,
    performAggregatedSlippageCheck: boolean
  ): Promise<string[]> {
    // First call to constructSwaps creates an array of TxAuthRequests for EATs to be issued for
    const txAuthRequestArray = <TxAuthRequest[]>(
      this.constructSwaps(trade, options, routerMustCustody, performAggregatedSlippageCheck)
    )

    const { sender } = options

    if (!sender) {
      throw new Error('Missing sender')
    }

    const multiTxAuthRequest: MultiTxAuthRequest = {
      from: sender,
      txAuthRequestArray,
    }

    // TxAuthRequests are passed to the API and returns EATs
    const eatArray: EthereumAccessToken[] = await fetchEats(multiTxAuthRequest)

    // Second call to constructSwaps with EATs returns an array of TxAuthResponses which are prepared transactions with EATs
    const txAuthResponses = <TxAuthResponse[]>(
      this.constructSwaps(trade, options, routerMustCustody, performAggregatedSlippageCheck, eatArray)
    )

    return txAuthResponses
  }

  /**
   * @notice Generates the calldata for a MixedRouteSwap. Since single hop routes are not MixedRoutes, we will instead generate
   *         them via the existing encodeV3Swap and encodeV2Swap methods.
   * @param trade The MixedRouteTrade to encode.
   * @param options SwapOptions to use for the trade.
   * @param routerMustCustody Flag for whether funds should be sent to the router
   * @param performAggregatedSlippageCheck Flag for whether we want to perform an aggregated slippage check
   * @returns A string array of calldatas for the trade.
   */
  private static encodeMixedRouteSwap(
    trade: MixedRouteTrade<Currency, Currency, TradeType>,
    options: SwapOptions,
    routerMustCustody: boolean,
    performAggregatedSlippageCheck: boolean
  ): string[] {
    const calldatas: string[] = []

    invariant(trade.tradeType === TradeType.EXACT_INPUT, 'TRADE_TYPE')

    for (const { route, inputAmount, outputAmount } of trade.swaps) {
      const amountIn: string = toHex(trade.maximumAmountIn(options.slippageTolerance, inputAmount).quotient)
      const amountOut: string = toHex(trade.minimumAmountOut(options.slippageTolerance, outputAmount).quotient)

      // flag for whether the trade is single hop or not
      const singleHop = route.pools.length === 1

      const recipient = routerMustCustody
        ? ADDRESS_THIS
        : typeof options.recipient === 'undefined'
        ? MSG_SENDER
        : validateAndParseAddress(options.recipient)

      const mixedRouteIsAllV3 = (route: MixedRouteSDK<Currency, Currency>) => {
        return route.pools.every((pool) => pool instanceof Pool)
      }

      if (singleHop) {
        /// For single hop, since it isn't really a mixedRoute, we'll just mimic behavior of V3 or V2
        /// We don't use encodeV3Swap() or encodeV2Swap() because casting the trade to a V3Trade or V2Trade is overcomplex
        if (mixedRouteIsAllV3(route)) {
          const exactInputSingleParams = {
            tokenIn: route.path[0].address,
            tokenOut: route.path[1].address,
            fee: (route.pools as Pool[])[0].fee,
            recipient,
            amountIn,
            amountOutMinimum: performAggregatedSlippageCheck ? 0 : amountOut,
            sqrtPriceLimitX96: 0,
          }

          calldatas.push(SwapRouter.INTERFACE.encodeFunctionData('exactInputSingle', [exactInputSingleParams]))
        } else {
          const path = route.path.map((token) => token.address)

          const exactInputParams = [amountIn, performAggregatedSlippageCheck ? 0 : amountOut, path, recipient]

          calldatas.push(SwapRouter.INTERFACE.encodeFunctionData('swapExactTokensForTokens', exactInputParams))
        }
      } else {
        const sections = partitionMixedRouteByProtocol(route)

        const isLastSectionInRoute = (i: number) => {
          return i === sections.length - 1
        }

        let outputToken
        let inputToken = route.input.wrapped

        for (let i = 0; i < sections.length; i++) {
          const section = sections[i]
          /// Now, we get output of this section
          outputToken = getOutputOfPools(section, inputToken)

          const newRouteOriginal = new MixedRouteSDK(
            [...section],
            section[0].token0.equals(inputToken) ? section[0].token0 : section[0].token1,
            outputToken
          )
          const newRoute = new MixedRoute(newRouteOriginal)

          /// Previous output is now input
          inputToken = outputToken

          if (mixedRouteIsAllV3(newRoute)) {
            const path: string = encodeMixedRouteToPath(newRoute)
            const exactInputParams = {
              path,
              // By default router holds funds until the last swap, then it is sent to the recipient
              // special case exists where we are unwrapping WETH output, in which case `routerMustCustody` is set to true
              // and router still holds the funds. That logic bundled into how the value of `recipient` is calculated
              recipient: isLastSectionInRoute(i) ? recipient : ADDRESS_THIS,
              amountIn: i == 0 ? amountIn : 0,
              amountOutMinimum: !isLastSectionInRoute(i) ? 0 : amountOut,
            }

            calldatas.push(SwapRouter.INTERFACE.encodeFunctionData('exactInput', [exactInputParams]))
          } else {
            const exactInputParams = [
              i == 0 ? amountIn : 0, // amountIn
              !isLastSectionInRoute(i) ? 0 : amountOut, // amountOutMin
              newRoute.path.map((token) => token.address), // path
              isLastSectionInRoute(i) ? recipient : ADDRESS_THIS, // to
            ]

            calldatas.push(SwapRouter.INTERFACE.encodeFunctionData('swapExactTokensForTokens', exactInputParams))
          }
        }
      }
    }

    return calldatas
  }

  private static async encodeSwaps(
    trades: AnyTradeType,
    options: SwapOptions,
    isSwapAndAdd?: boolean
  ): Promise<{
    calldatas: string[]
    sampleTrade:
      | V2Trade<Currency, Currency, TradeType>
      | V3Trade<Currency, Currency, TradeType>
      | MixedRouteTrade<Currency, Currency, TradeType>
    routerMustCustody: boolean
    inputIsNative: boolean
    outputIsNative: boolean
    totalAmountIn: CurrencyAmount<Currency>
    minimumAmountOut: CurrencyAmount<Currency>
    quoteAmountOut: CurrencyAmount<Currency>
  }> {
    // If dealing with an instance of the aggregated Trade object, unbundle it to individual trade objects.
    if (trades instanceof Trade) {
      invariant(
        trades.swaps.every(
          (swap) =>
            swap.route.protocol == Protocol.V3 ||
            swap.route.protocol == Protocol.V2 ||
            swap.route.protocol == Protocol.MIXED
        ),
        'UNSUPPORTED_PROTOCOL'
      )

      let individualTrades: (
        | V2Trade<Currency, Currency, TradeType>
        | V3Trade<Currency, Currency, TradeType>
        | MixedRouteTrade<Currency, Currency, TradeType>
      )[] = []

      for (const { route, inputAmount, outputAmount } of trades.swaps) {
        if (route.protocol == Protocol.V2) {
          individualTrades.push(
            new V2Trade(
              route as RouteV2<Currency, Currency>,
              trades.tradeType == TradeType.EXACT_INPUT ? inputAmount : outputAmount,
              trades.tradeType
            )
          )
        } else if (route.protocol == Protocol.V3) {
          individualTrades.push(
            V3Trade.createUncheckedTrade({
              route: route as RouteV3<Currency, Currency>,
              inputAmount,
              outputAmount,
              tradeType: trades.tradeType,
            })
          )
        } else if (route.protocol == Protocol.MIXED) {
          individualTrades.push(
            /// we can change the naming of this function on MixedRouteTrade if needed
            MixedRouteTrade.createUncheckedTrade({
              route: route as MixedRoute<Currency, Currency>,
              inputAmount,
              outputAmount,
              tradeType: trades.tradeType,
            })
          )
        } else {
          throw new Error('UNSUPPORTED_TRADE_PROTOCOL')
        }
      }
      trades = individualTrades
    }

    if (!Array.isArray(trades)) {
      trades = [trades]
    }

    const numberOfTrades = trades.reduce(
      (numberOfTrades, trade) =>
        numberOfTrades + (trade instanceof V3Trade || trade instanceof MixedRouteTrade ? trade.swaps.length : 1),
      0
    )

    const sampleTrade = trades[0]

    // All trades should have the same starting/ending currency and trade type
    invariant(
      trades.every((trade) => trade.inputAmount.currency.equals(sampleTrade.inputAmount.currency)),
      'TOKEN_IN_DIFF'
    )
    invariant(
      trades.every((trade) => trade.outputAmount.currency.equals(sampleTrade.outputAmount.currency)),
      'TOKEN_OUT_DIFF'
    )
    invariant(
      trades.every((trade) => trade.tradeType === sampleTrade.tradeType),
      'TRADE_TYPE_DIFF'
    )

    const calldatas: string[] = []

    const inputIsNative = sampleTrade.inputAmount.currency.isNative
    const outputIsNative = sampleTrade.outputAmount.currency.isNative

    // flag for whether we want to perform an aggregated slippage check
    //   1. when there are >2 exact input trades. this is only a heuristic,
    //      as it's still more gas-expensive even in this case, but has benefits
    //      in that the reversion probability is lower
    const performAggregatedSlippageCheck = sampleTrade.tradeType === TradeType.EXACT_INPUT && numberOfTrades > 2
    // flag for whether funds should be send first to the router
    //   1. when receiving ETH (which much be unwrapped from WETH)
    //   2. when a fee on the output is being taken
    //   3. when performing swap and add
    //   4. when performing an aggregated slippage check
    const routerMustCustody = outputIsNative || !!options.fee || !!isSwapAndAdd || performAggregatedSlippageCheck

    // encode permit if necessary
    if (options.inputTokenPermit) {
      invariant(sampleTrade.inputAmount.currency.isToken, 'NON_TOKEN_PERMIT')
      calldatas.push(SelfPermit.encodePermit(sampleTrade.inputAmount.currency, options.inputTokenPermit))
    }

    for (const trade of trades) {
      if (trade instanceof V2Trade) {
        calldatas.push(SwapRouter.encodeV2Swap(trade, options, routerMustCustody, performAggregatedSlippageCheck))
      } else if (trade instanceof V3Trade) {
        for (const calldata of await SwapRouter.encodeV3Swap(
          trade,
          options,
          routerMustCustody,
          performAggregatedSlippageCheck
        )) {
          calldatas.push(calldata)
        }
      } else if (trade instanceof MixedRouteTrade) {
        for (const calldata of SwapRouter.encodeMixedRouteSwap(
          trade,
          options,
          routerMustCustody,
          performAggregatedSlippageCheck
        )) {
          calldatas.push(calldata)
        }
      } else {
        throw new Error('Unsupported trade object')
      }
    }

    const ZERO_IN: CurrencyAmount<Currency> = CurrencyAmount.fromRawAmount(sampleTrade.inputAmount.currency, 0)
    const ZERO_OUT: CurrencyAmount<Currency> = CurrencyAmount.fromRawAmount(sampleTrade.outputAmount.currency, 0)

    const minimumAmountOut: CurrencyAmount<Currency> = trades.reduce(
      (sum, trade) => sum.add(trade.minimumAmountOut(options.slippageTolerance)),
      ZERO_OUT
    )

    const quoteAmountOut: CurrencyAmount<Currency> = trades.reduce(
      (sum, trade) => sum.add(trade.outputAmount),
      ZERO_OUT
    )

    const totalAmountIn: CurrencyAmount<Currency> = trades.reduce(
      (sum, trade) => sum.add(trade.maximumAmountIn(options.slippageTolerance)),
      ZERO_IN
    )

    return {
      calldatas,
      sampleTrade,
      routerMustCustody,
      inputIsNative,
      outputIsNative,
      totalAmountIn,
      minimumAmountOut,
      quoteAmountOut,
    }
  }

  /**
   * Produces the on-chain method name to call and the hex encoded parameters to pass as arguments for a given trade.
   * @param trades to produce call parameters for
   * @param options options for the call parameters
   */
  public static async swapCallParameters(
    trades:
      | Trade<Currency, Currency, TradeType>
      | V2Trade<Currency, Currency, TradeType>
      | V3Trade<Currency, Currency, TradeType>
      | MixedRouteTrade<Currency, Currency, TradeType>
      | (
          | V2Trade<Currency, Currency, TradeType>
          | V3Trade<Currency, Currency, TradeType>
          | MixedRouteTrade<Currency, Currency, TradeType>
        )[],
    options: SwapOptions
  ): Promise<MethodParameters> {
    const {
      calldatas,
      sampleTrade,
      routerMustCustody,
      inputIsNative,
      outputIsNative,
      totalAmountIn,
      minimumAmountOut,
    } = await SwapRouter.encodeSwaps(trades, options)

    // unwrap or sweep
    if (routerMustCustody) {
      if (outputIsNative) {
        calldatas.push(PaymentsExtended.encodeUnwrapWETH9(minimumAmountOut.quotient, options.recipient, options.fee))
      } else {
        calldatas.push(
          PaymentsExtended.encodeSweepToken(
            sampleTrade.outputAmount.currency.wrapped,
            minimumAmountOut.quotient,
            options.recipient,
            options.fee
          )
        )
      }
    }

    // must refund when paying in ETH: either with an uncertain input amount OR if there's a chance of a partial fill.
    // unlike ERC20's, the full ETH value must be sent in the transaction, so the rest must be refunded.
    if (inputIsNative && (sampleTrade.tradeType === TradeType.EXACT_OUTPUT || SwapRouter.riskOfPartialFill(trades))) {
      calldatas.push(Payments.encodeRefundETH())
    }

    return {
      calldata: MulticallExtended.encodeMulticall(calldatas, options.deadlineOrPreviousBlockhash),
      value: toHex(inputIsNative ? totalAmountIn.quotient : ZERO),
    }
  }

  /**
   * Produces the on-chain method name to call and the hex encoded parameters to pass as arguments for a given trade.
   * @param trades to produce call parameters for
   * @param options options for the call parameters
   */
  public static async swapAndAddCallParameters(
    trades: AnyTradeType,
    options: SwapAndAddOptions,
    position: Position,
    addLiquidityOptions: CondensedAddLiquidityOptions,
    tokenInApprovalType: ApprovalTypes,
    tokenOutApprovalType: ApprovalTypes
  ): Promise<MethodParameters> {
    const {
      calldatas,
      inputIsNative,
      outputIsNative,
      sampleTrade,
      totalAmountIn: totalAmountSwapped,
      quoteAmountOut,
      minimumAmountOut,
    } = await SwapRouter.encodeSwaps(trades, options, true)

    // encode output token permit if necessary
    if (options.outputTokenPermit) {
      invariant(quoteAmountOut.currency.isToken, 'NON_TOKEN_PERMIT_OUTPUT')
      calldatas.push(SelfPermit.encodePermit(quoteAmountOut.currency, options.outputTokenPermit))
    }

    const chainId = sampleTrade.route.chainId
    const zeroForOne = position.pool.token0.wrapped.address === totalAmountSwapped.currency.wrapped.address
    const { positionAmountIn, positionAmountOut } = SwapRouter.getPositionAmounts(position, zeroForOne)

    // if tokens are native they will be converted to WETH9
    const tokenIn = inputIsNative ? WETH9[chainId] : positionAmountIn.currency.wrapped
    const tokenOut = outputIsNative ? WETH9[chainId] : positionAmountOut.currency.wrapped

    // if swap output does not make up whole outputTokenBalanceDesired, pull in remaining tokens for adding liquidity
    const amountOutRemaining = positionAmountOut.subtract(quoteAmountOut.wrapped)
    if (amountOutRemaining.greaterThan(CurrencyAmount.fromRawAmount(positionAmountOut.currency, 0))) {
      // if output is native, this means the remaining portion is included as native value in the transaction
      // and must be wrapped. Otherwise, pull in remaining ERC20 token.
      outputIsNative
        ? calldatas.push(PaymentsExtended.encodeWrapETH(amountOutRemaining.quotient))
        : calldatas.push(PaymentsExtended.encodePull(tokenOut, amountOutRemaining.quotient))
    }

    // if input is native, convert to WETH9, else pull ERC20 token
    inputIsNative
      ? calldatas.push(PaymentsExtended.encodeWrapETH(positionAmountIn.quotient))
      : calldatas.push(PaymentsExtended.encodePull(tokenIn, positionAmountIn.quotient))

    // approve token balances to NFTManager
    if (tokenInApprovalType !== ApprovalTypes.NOT_REQUIRED)
      calldatas.push(ApproveAndCall.encodeApprove(tokenIn, tokenInApprovalType))
    if (tokenOutApprovalType !== ApprovalTypes.NOT_REQUIRED)
      calldatas.push(ApproveAndCall.encodeApprove(tokenOut, tokenOutApprovalType))

    // represents a position with token amounts resulting from a swap with maximum slippage
    // hence the minimal amount out possible.
    const minimalPosition = Position.fromAmounts({
      pool: position.pool,
      tickLower: position.tickLower,
      tickUpper: position.tickUpper,
      amount0: zeroForOne ? position.amount0.quotient.toString() : minimumAmountOut.quotient.toString(),
      amount1: zeroForOne ? minimumAmountOut.quotient.toString() : position.amount1.quotient.toString(),
      useFullPrecision: false,
    })

    // encode NFTManager add liquidity
    calldatas.push(
      ApproveAndCall.encodeAddLiquidity(position, minimalPosition, addLiquidityOptions, options.slippageTolerance)
    )

    // sweep remaining tokens
    inputIsNative
      ? calldatas.push(PaymentsExtended.encodeUnwrapWETH9(ZERO))
      : calldatas.push(PaymentsExtended.encodeSweepToken(tokenIn, ZERO))
    outputIsNative
      ? calldatas.push(PaymentsExtended.encodeUnwrapWETH9(ZERO))
      : calldatas.push(PaymentsExtended.encodeSweepToken(tokenOut, ZERO))

    let value: JSBI
    if (inputIsNative) {
      value = totalAmountSwapped.wrapped.add(positionAmountIn.wrapped).quotient
    } else if (outputIsNative) {
      value = amountOutRemaining.quotient
    } else {
      value = ZERO
    }

    return {
      calldata: MulticallExtended.encodeMulticall(calldatas, options.deadlineOrPreviousBlockhash),
      value: value.toString(),
    }
  }

  // if price impact is very high, there's a chance of hitting max/min prices resulting in a partial fill of the swap
  private static riskOfPartialFill(trades: AnyTradeType): boolean {
    if (Array.isArray(trades)) {
      return trades.some((trade) => {
        return SwapRouter.v3TradeWithHighPriceImpact(trade)
      })
    } else {
      return SwapRouter.v3TradeWithHighPriceImpact(trades)
    }
  }

  private static v3TradeWithHighPriceImpact(
    trade:
      | Trade<Currency, Currency, TradeType>
      | V2Trade<Currency, Currency, TradeType>
      | V3Trade<Currency, Currency, TradeType>
      | MixedRouteTrade<Currency, Currency, TradeType>
  ): boolean {
    return !(trade instanceof V2Trade) && trade.priceImpact.greaterThan(REFUND_ETH_PRICE_IMPACT_THRESHOLD)
  }

  private static getPositionAmounts(
    position: Position,
    zeroForOne: boolean
  ): {
    positionAmountIn: CurrencyAmount<Currency>
    positionAmountOut: CurrencyAmount<Currency>
  } {
    const { amount0, amount1 } = position.mintAmounts
    const currencyAmount0 = CurrencyAmount.fromRawAmount(position.pool.token0, amount0)
    const currencyAmount1 = CurrencyAmount.fromRawAmount(position.pool.token1, amount1)

    const [positionAmountIn, positionAmountOut] = zeroForOne
      ? [currencyAmount0, currencyAmount1]
      : [currencyAmount1, currencyAmount0]
    return { positionAmountIn, positionAmountOut }
  }
}
