import { CurrencyAmount, Ether, Percent, Token, TradeType, WETH9 } from '@violetprotocol/mauve-sdk-core'
import {
  encodeSqrtRatioX96,
  FeeAmount,
  nearestUsableTick,
  Pool,
  Route as V3Route,
  TickMath,
  TICK_SPACINGS,
  Trade as V3Trade,
} from '@violetprotocol/mauve-v3-sdk'
import JSBI from 'jsbi'
import { ADDRESS_THIS, PaymentsExtended, SwapRouter, Trade } from '.'
import { EATMulticallExtended } from './EATmulticallExtended'
import { REFUND_ETH_FUNC_SIG } from './utils/functionSignatures'
import { encodeTrade, encodeMultiHopTrade } from './utils/tradeEncoding'

describe('SwapRouter', () => {
  const ETHER = Ether.onChain(1)
  const WETH = WETH9[1]

  const token0 = new Token(1, '0x0000000000000000000000000000000000000001', 18, 't0', 'token0')
  // TODO: Change following address as it might be confused with ADDRESS_THIS?
  const token1 = new Token(1, '0x0000000000000000000000000000000000000002', 18, 't1', 'token1')

  const feeAmount = FeeAmount.MEDIUM
  const sqrtRatioX96 = encodeSqrtRatioX96(1, 1)
  const liquidity = 1_000_000

  // v3
  const makePool = (token0: Token, token1: Token, liquidity: number) => {
    return new Pool(token0, token1, feeAmount, sqrtRatioX96, liquidity, TickMath.getTickAtSqrtRatio(sqrtRatioX96), [
      {
        index: nearestUsableTick(TickMath.MIN_TICK, TICK_SPACINGS[feeAmount]),
        liquidityNet: liquidity,
        liquidityGross: liquidity,
      },
      {
        index: nearestUsableTick(TickMath.MAX_TICK, TICK_SPACINGS[feeAmount]),
        liquidityNet: -liquidity,
        liquidityGross: liquidity,
      },
    ])
  }

  const pool_0_1 = makePool(token0, token1, liquidity)

  const pool_1_WETH = makePool(token1, WETH, liquidity)

  const slippageTolerance = new Percent(1, 100)
  const recipient = '0x0000000000000000000000000000000000000003'
  const deadline = 123

  describe('#swapCallParameters', () => {
    describe('single-hop exact input (v3)', () => {
      describe('different trade configurations result in identical calldata', () => {
        const amountIn = CurrencyAmount.fromRawAmount(token0, JSBI.BigInt(100))

        const v3Trade = V3Trade.fromRoute(new V3Route([pool_0_1], token0, token1), amountIn, TradeType.EXACT_INPUT)

        it('array of trades', async () => {
          const trade = await v3Trade
          const trades = [trade]
          const encodedTrade = encodeTrade(
            'exactInputSingle',
            token0,
            token1,
            pool_0_1,
            recipient,
            trade.maximumAmountIn(slippageTolerance, trade.inputAmount).quotient,
            trade.minimumAmountOut(slippageTolerance, trade.outputAmount).quotient
          )
          const preSignMulticall = EATMulticallExtended.encodePresignMulticallExtended(encodedTrade, deadline)

          const { calls, parameters, value } = await SwapRouter.swapCallParameters(trades, {
            slippageTolerance,
            recipient,
            deadlineOrPreviousBlockhash: deadline,
          })

          expect(calls).toEqual([encodedTrade])
          expect(parameters).toEqual(preSignMulticall.parameters)
          expect(value).toBe('0x00')
        })

        it('meta-trade', async () => {
          const trade = await Trade.fromRoutes(
            [
              {
                routev3: (await v3Trade).swaps[0].route,
                amount: amountIn,
              },
            ],
            TradeType.EXACT_INPUT
          )

          const encodedTrade = encodeTrade(
            'exactInputSingle',
            token0,
            token1,
            pool_0_1,
            recipient,
            trade.maximumAmountIn(slippageTolerance, trade.inputAmount).quotient,
            trade.minimumAmountOut(slippageTolerance, trade.outputAmount).quotient
          )
          const preSignMulticall = EATMulticallExtended.encodePresignMulticallExtended(encodedTrade, deadline)

          const { calls, parameters, value } = await SwapRouter.swapCallParameters(trade, {
            slippageTolerance,
            recipient,
            deadlineOrPreviousBlockhash: deadline,
          })

          expect(calls).toEqual([encodedTrade])
          expect(parameters).toEqual(preSignMulticall.parameters)
          expect(value).toBe('0x00')
        })
      })
    })

    describe('single-hop exact output (v3)', () => {
      describe('different trade configurations result in identical calldata', () => {
        const amountOut = CurrencyAmount.fromRawAmount(token1, JSBI.BigInt(100))

        const v3Trade = V3Trade.fromRoute(new V3Route([pool_0_1], token0, token1), amountOut, TradeType.EXACT_OUTPUT)

        it('array of trades', async () => {
          const trade = await v3Trade
          const trades = [trade]

          const encodedTrade = encodeTrade(
            'exactOutputSingle',
            token0,
            token1,
            pool_0_1,
            recipient,
            trade.minimumAmountOut(slippageTolerance, trade.outputAmount).quotient,
            trade.maximumAmountIn(slippageTolerance, trade.inputAmount).quotient
          )
          const preSignMulticall = EATMulticallExtended.encodePresignMulticallExtended(encodedTrade, deadline)

          const { parameters, calls, value } = await SwapRouter.swapCallParameters(trades, {
            slippageTolerance,
            recipient,
            deadlineOrPreviousBlockhash: deadline,
          })

          expect(calls).toEqual([encodedTrade])
          expect(parameters).toEqual(preSignMulticall.parameters)
          expect(value).toBe('0x00')
        })

        it('meta-trade', async () => {
          const trade = await v3Trade
          const trades = await Trade.fromRoutes(
            [
              {
                routev3: trade.swaps[0].route,
                amount: amountOut,
              },
            ],
            TradeType.EXACT_OUTPUT
          )

          const encodedTrade = encodeTrade(
            'exactOutputSingle',
            token0,
            token1,
            pool_0_1,
            recipient,
            trade.minimumAmountOut(slippageTolerance, trade.outputAmount).quotient,
            trade.maximumAmountIn(slippageTolerance, trade.inputAmount).quotient
          )
          const preSignMulticall = EATMulticallExtended.encodePresignMulticallExtended(encodedTrade, deadline)
          const { parameters, calls, value } = await SwapRouter.swapCallParameters(trades, {
            slippageTolerance,
            recipient,
            deadlineOrPreviousBlockhash: deadline,
          })
          expect(calls).toEqual([encodedTrade])
          expect(parameters).toEqual(preSignMulticall.parameters)
          expect(value).toBe('0x00')
        })
      })
    })

    describe('multi-hop exact input (v3)', () => {
      describe('different trade configurations result in identical calldata', () => {
        const amountIn = CurrencyAmount.fromRawAmount(token0, JSBI.BigInt(100))

        const v3Trade = V3Trade.fromRoute(
          new V3Route([pool_0_1, pool_1_WETH], token0, WETH),
          amountIn,
          TradeType.EXACT_INPUT
        )

        it('array of trades', async () => {
          const trade = await v3Trade
          const trades = [trade]
          const encodedTrade = encodeMultiHopTrade(
            TradeType.EXACT_INPUT,
            new V3Route([pool_0_1, pool_1_WETH], token0, WETH),
            recipient,
            trade.maximumAmountIn(slippageTolerance, trade.inputAmount).quotient,
            trade.minimumAmountOut(slippageTolerance, trade.outputAmount).quotient
          )

          const preSignMulticall = EATMulticallExtended.encodePresignMulticallExtended(encodedTrade, deadline)
          const { parameters, calls, value } = await SwapRouter.swapCallParameters(trades, {
            slippageTolerance,
            recipient,
            deadlineOrPreviousBlockhash: deadline,
          })

          expect(calls).toEqual([encodedTrade])
          expect(parameters).toEqual(preSignMulticall.parameters)
          expect(value).toBe('0x00')
        })

        it('meta-trade', async () => {
          const trade = await v3Trade
          const trades = await Trade.fromRoutes(
            [
              {
                routev3: trade.swaps[0].route,
                amount: amountIn,
              },
            ],
            TradeType.EXACT_INPUT
          )
          const encodedTrade = encodeMultiHopTrade(
            TradeType.EXACT_INPUT,
            new V3Route([pool_0_1, pool_1_WETH], token0, WETH),
            recipient,
            trade.maximumAmountIn(slippageTolerance, trade.inputAmount).quotient,
            trade.minimumAmountOut(slippageTolerance, trade.outputAmount).quotient
          )
          const preSignMulticall = EATMulticallExtended.encodePresignMulticallExtended(encodedTrade, deadline)

          const { parameters, calls, value } = await SwapRouter.swapCallParameters(trades, {
            slippageTolerance,
            recipient,
            deadlineOrPreviousBlockhash: deadline,
          })

          expect(calls).toEqual([encodedTrade])
          expect(parameters).toEqual(preSignMulticall.parameters)
          expect(value).toBe('0x00')
        })
      })
    })

    describe('multi-hop exact output (v3)', () => {
      describe('different trade configurations result in identical calldata', () => {
        const amountOut = CurrencyAmount.fromRawAmount(WETH, JSBI.BigInt(100))

        const v3Trade = V3Trade.fromRoute(
          new V3Route([pool_0_1, pool_1_WETH], token0, WETH),
          amountOut,
          TradeType.EXACT_OUTPUT
        )

        it('array of trades', async () => {
          const trade = await v3Trade
          const trades = [trade]

          const encodedTrade = encodeMultiHopTrade(
            TradeType.EXACT_OUTPUT,
            new V3Route([pool_0_1, pool_1_WETH], token0, WETH),
            recipient,
            trade.minimumAmountOut(slippageTolerance, trade.outputAmount).quotient,
            trade.maximumAmountIn(slippageTolerance, trade.inputAmount).quotient
          )
          const preSignMulticall = EATMulticallExtended.encodePresignMulticallExtended(encodedTrade, deadline)

          const { parameters, calls, value } = await SwapRouter.swapCallParameters(trades, {
            slippageTolerance,
            recipient,
            deadlineOrPreviousBlockhash: deadline,
          })

          expect(calls).toEqual([encodedTrade])
          expect(parameters).toEqual(preSignMulticall.parameters)
          expect(value).toBe('0x00')
        })

        it('meta-trade', async () => {
          const trade = await v3Trade
          const trades = await Trade.fromRoutes(
            [
              {
                routev3: trade.swaps[0].route,
                amount: amountOut,
              },
            ],
            TradeType.EXACT_OUTPUT
          )

          const encodedTrade = encodeMultiHopTrade(
            TradeType.EXACT_OUTPUT,
            new V3Route([pool_0_1, pool_1_WETH], token0, WETH),
            recipient,
            trade.minimumAmountOut(slippageTolerance, trade.outputAmount).quotient,
            trade.maximumAmountIn(slippageTolerance, trade.inputAmount).quotient
          )
          const preSignMulticall = EATMulticallExtended.encodePresignMulticallExtended(encodedTrade, deadline)

          const { parameters, calls, value } = await SwapRouter.swapCallParameters(trades, {
            slippageTolerance,
            recipient,
            deadlineOrPreviousBlockhash: deadline,
          })

          expect(calls).toEqual([encodedTrade])
          expect(parameters).toEqual(preSignMulticall.parameters)
          expect(value).toBe('0x00')
        })
      })
    })

    // [MAUVE_DISABLED]: Mixed routes are disabled
    // describe('Mixed Route', () => {
    //   describe('single-hop exact input (v2 + v3) backwards compatible', () => {
    //     describe('different trade configurations result in identical calldata', () => {
    //       it('generates the same calldata', async () => {
    //         const trades = [await v3Trade]
    //         const { parameters, calls, value } = await SwapRouter.swapCallParameters(trades, {
    //           slippageTolerance,
    //           recipient,
    //           deadlineOrPreviousBlockhash: deadline,
    //         })
    //         expect(calls).toEqual([encodedTrade])
    //         expect(value).toBe('0x00')
    //         const mixedRouteTrades = [await mixedRouteTrade1, await mixedRouteTrade2]
    //         const { calldata: mixedRouteCalldata, value: mixedRouteValue } = await SwapRouter.swapCallParameters(
    //           mixedRouteTrades,
    //           {
    //             slippageTolerance,
    //             recipient,
    //             deadlineOrPreviousBlockhash: deadline,
    //           }
    //         )
    //         expect(mixedRouteCalldata).toEqual(expectedCalldata)
    //         expect(mixedRouteValue).toBe('0x00')
    //       })
    //       it('meta-trade', async () => {
    //         const trades = await Trade.fromRoutes(
    //           [
    //             {
    //               routev3: (await v3Trade).swaps[0].route,
    //               amount: amountIn,
    //             },
    //           ],
    //           TradeType.EXACT_INPUT
    //         )
    //         const { parameters, calls, value } = await SwapRouter.swapCallParameters(trades, {
    //           slippageTolerance,
    //           recipient,
    //           deadlineOrPreviousBlockhash: deadline,
    //         })
    //         expect(calls).toEqual([encodedTrade])
    //         expect(value).toBe('0x00')
    //         const mixedRouteTrades = await Trade.fromRoutes([], [], TradeType.EXACT_INPUT, [
    //           {
    //             mixedRoute: (await mixedRouteTrade1).swaps[0].route,
    //             amount: amountIn,
    //           },
    //           {
    //             mixedRoute: (await mixedRouteTrade2).swaps[0].route,
    //             amount: amountIn,
    //           },
    //         ])
    //         const { calldata: mixedRouteCalldata, value: mixedRouteValue } = await SwapRouter.swapCallParameters(
    //           mixedRouteTrades,
    //           {
    //             slippageTolerance,
    //             recipient,
    //             deadlineOrPreviousBlockhash: deadline,
    //           }
    //         )
    //         expect(mixedRouteCalldata).toEqual(expectedCalldata)
    //         expect(mixedRouteValue).toBe('0x00')
    //       })
    //     })
    //   })

    //   describe('multi-hop exact input (mixed route) backwards compatible', () => {
    //     describe('different trade configurations result in identical calldata', () => {
    //       /// calldata verified and taken from existing test
    //       const expectedCalldata =
    //         '0x5ae401dc000000000000000000000000000000000000000000000000000000000000007b00000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000001800000000000000000000000000000000000000000000000000000000000000104472b43f30000000000000000000000000000000000000000000000000000000000000064000000000000000000000000000000000000000000000000000000000000006100000000000000000000000000000000000000000000000000000000000000800000000000000000000000000000000000000000000000000000000000000003000000000000000000000000000000000000000000000000000000000000000300000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000002000000000000000000000000c02aaa39b223fe8d0a0e5c4f27ead9083c756cc2000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000124b858183f0000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000008000000000000000000000000000000000000000000000000000000000000000030000000000000000000000000000000000000000000000000000000000000064000000000000000000000000000000000000000000000000000000000000005f00000000000000000000000000000000000000000000000000000000000000420000000000000000000000000000000000000001000bb80000000000000000000000000000000000000002000bb8c02aaa39b223fe8d0a0e5c4f27ead9083c756cc200000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000'
    //       const amountIn = CurrencyAmount.fromRawAmount(token0, JSBI.BigInt(100))

    //       const mixedRouteTrade1 = MixedRouteTrade.fromRoute(
    //         new MixedRouteSDK([pair_0_1, pair_1_WETH], token0, WETH),
    //         amountIn,
    //         TradeType.EXACT_INPUT
    //       )
    //       const mixedRouteTrade2 = MixedRouteTrade.fromRoute(
    //         new MixedRouteSDK([pool_0_1, pool_1_WETH], token0, WETH),
    //         amountIn,
    //         TradeType.EXACT_INPUT
    //       )

    //       it('single mixedRoute trade', async () => {
    //         const trades = [await mixedRouteTrade1, await mixedRouteTrade2]
    //         const { parameters, calls, value } = await SwapRouter.swapCallParameters(trades, {
    //           slippageTolerance,
    //           recipient,
    //           deadlineOrPreviousBlockhash: deadline,
    //         })
    //         expect(calls).toEqual([encodedTrade])
    //         expect(value).toBe('0x00')
    //       })

    //       it('meta-trade', async () => {
    //         const trades = await Trade.fromRoutes([], [], TradeType.EXACT_INPUT, [
    //           {
    //             mixedRoute: (await mixedRouteTrade1).swaps[0].route,
    //             amount: amountIn,
    //           },
    //           {
    //             mixedRoute: (await mixedRouteTrade2).swaps[0].route,
    //             amount: amountIn,
    //           },
    //         ])

    //         const { parameters, calls, value } = await SwapRouter.swapCallParameters(trades, {
    //           slippageTolerance,
    //           recipient,
    //           deadlineOrPreviousBlockhash: deadline,
    //         })
    //         expect(calls).toEqual([encodedTrade])
    //         expect(value).toBe('0x00')
    //       })
    //     })
    //   })

    //   describe('mixed route trades with routes with consecutive pools/pairs', () => {
    //     /// manually verified calldata
    //     const expectedCalldata =
    //       '0x5ae401dc000000000000000000000000000000000000000000000000000000000000007b00000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000008000000000000000000000000000000000000000000000000000000000000001e0000000000000000000000000000000000000000000000000000000000000030000000000000000000000000000000000000000000000000000000000000004400000000000000000000000000000000000000000000000000000000000000124b858183f0000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000008000000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000064000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000420000000000000000000000000000000000000001000bb80000000000000000000000000000000000000002000bb8c02aaa39b223fe8d0a0e5c4f27ead9083c756cc20000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000e4472b43f30000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000005e000000000000000000000000000000000000000000000000000000000000008000000000000000000000000000000000000000000000000000000000000000030000000000000000000000000000000000000000000000000000000000000002000000000000000000000000c02aaa39b223fe8d0a0e5c4f27ead9083c756cc20000000000000000000000000000000000000000000000000000000000000003000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000104472b43f300000000000000000000000000000000000000000000000000000000000000640000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000008000000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000003000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000003000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000104b858183f0000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000008000000000000000000000000000000000000000000000000000000000000000030000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000005f000000000000000000000000000000000000000000000000000000000000002b0000000000000000000000000000000000000003000bb8c02aaa39b223fe8d0a0e5c4f27ead9083c756cc200000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000'
    //     const amountIn = CurrencyAmount.fromRawAmount(token0, JSBI.BigInt(100))
    //     const mixedRouteTrade1 = MixedRouteTrade.fromRoute(
    //       new MixedRouteSDK([pool_0_1, pool_1_WETH, pair_2_WETH], token0, WETH),
    //       amountIn,
    //       TradeType.EXACT_INPUT
    //     )
    //     const mixedRouteTrade2 = MixedRouteTrade.fromRoute(
    //       new MixedRouteSDK([pair_0_1, pair_1_2, pool_2_WETH], token0, WETH),
    //       amountIn,
    //       TradeType.EXACT_INPUT
    //     )

    //     it('generates correct calldata', async () => {
    //       const trades = [await mixedRouteTrade1, await mixedRouteTrade2]
    //       const { parameters, calls, value } = await SwapRouter.swapCallParameters(trades, {
    //         slippageTolerance,
    //         recipient,
    //         deadlineOrPreviousBlockhash: deadline,
    //       })
    //       expect(calls).toEqual([encodedTrade])
    //       expect(value).toBe('0x00')
    //     })
    //   })
    // })

    describe('ETH input', () => {
      describe('single-hop exact input (v3)', () => {
        describe('different trade configurations result in identical calldata', () => {
          const amountIn = CurrencyAmount.fromRawAmount(ETHER, JSBI.BigInt(100))

          const v3Trade = V3Trade.fromRoute(new V3Route([pool_1_WETH], ETHER, token1), amountIn, TradeType.EXACT_INPUT)

          it('array of trades', async () => {
            const trade = await v3Trade
            const trades = [trade]
            const encodedTrade = encodeTrade(
              'exactInputSingle',
              WETH,
              token1,
              pool_1_WETH,
              recipient,
              trade.maximumAmountIn(slippageTolerance, trade.inputAmount).quotient,
              trade.minimumAmountOut(slippageTolerance, trade.outputAmount).quotient
            )
            const preSignMulticall = EATMulticallExtended.encodePresignMulticallExtended(encodedTrade, deadline)

            const { parameters, calls, value } = await SwapRouter.swapCallParameters(trades, {
              slippageTolerance,
              recipient,
              deadlineOrPreviousBlockhash: deadline,
            })
            expect(calls).toEqual([encodedTrade])
            expect(parameters).toEqual(preSignMulticall.parameters)
            expect(value).toBe('0x64') // 100
          })

          it('meta-trade', async () => {
            const trade = await v3Trade
            const trades = await Trade.fromRoutes(
              [
                {
                  routev3: trade.swaps[0].route,
                  amount: amountIn,
                },
              ],
              TradeType.EXACT_INPUT
            )
            const encodedTrade = encodeTrade(
              'exactInputSingle',
              WETH,
              token1,
              pool_1_WETH,
              recipient,
              trade.maximumAmountIn(slippageTolerance, trade.inputAmount).quotient,
              trade.minimumAmountOut(slippageTolerance, trade.outputAmount).quotient
            )
            const preSignMulticall = EATMulticallExtended.encodePresignMulticallExtended(encodedTrade, deadline)

            const { parameters, calls, value } = await SwapRouter.swapCallParameters(trades, {
              slippageTolerance,
              recipient,
              deadlineOrPreviousBlockhash: deadline,
            })
            expect(calls).toEqual([encodedTrade])
            expect(parameters).toEqual(preSignMulticall.parameters)
            expect(value).toBe('0x64')
          })
        })
      })

      describe('single-hop exact output (v3)', () => {
        describe('different trade configurations result in identical calldata', () => {
          const amountOut = CurrencyAmount.fromRawAmount(token1, JSBI.BigInt(100))

          const v3Trade = V3Trade.fromRoute(
            new V3Route([pool_1_WETH], ETHER, token1),
            amountOut,
            TradeType.EXACT_OUTPUT
          )

          it('array of trades', async () => {
            const trade = await v3Trade
            const trades = [await v3Trade]

            const encodedTrade = encodeTrade(
              'exactOutputSingle',
              WETH,
              token1,
              pool_1_WETH,
              recipient,
              trade.minimumAmountOut(slippageTolerance, trade.outputAmount).quotient,
              trade.maximumAmountIn(slippageTolerance, trade.inputAmount).quotient
            )

            // must refund when paying in ETH: either with an exact output amount OR if there's a chance of a partial fill.
            const expectedCalls = [encodedTrade, REFUND_ETH_FUNC_SIG]
            const preSignMulticall = EATMulticallExtended.encodePresignMulticallExtended(expectedCalls, deadline)

            const { parameters, calls, value } = await SwapRouter.swapCallParameters(trades, {
              slippageTolerance,
              recipient,
              deadlineOrPreviousBlockhash: deadline,
            })
            expect(calls).toEqual(expectedCalls)
            expect(parameters).toEqual(preSignMulticall.parameters)
            expect(value).toBe('0x67')
          })

          it('meta-trade', async () => {
            const trade = await v3Trade
            const trades = await Trade.fromRoutes(
              [
                {
                  routev3: trade.swaps[0].route,
                  amount: amountOut,
                },
              ],
              TradeType.EXACT_OUTPUT
            )
            const encodedTrade = encodeTrade(
              'exactOutputSingle',
              WETH,
              token1,
              pool_1_WETH,
              recipient,
              trade.minimumAmountOut(slippageTolerance, trade.outputAmount).quotient,
              trade.maximumAmountIn(slippageTolerance, trade.inputAmount).quotient
            )
            const expectedCalls = [encodedTrade, REFUND_ETH_FUNC_SIG]
            const preSignMulticall = EATMulticallExtended.encodePresignMulticallExtended(expectedCalls, deadline)

            const { parameters, calls, value } = await SwapRouter.swapCallParameters(trades, {
              slippageTolerance,
              recipient,
              deadlineOrPreviousBlockhash: deadline,
            })
            expect(calls).toEqual(expectedCalls)
            expect(parameters).toEqual(preSignMulticall.parameters)
            expect(value).toBe('0x67')
          })
        })
      })

      describe('multi-hop exact input (v3)', () => {
        describe('different trade configurations result in identical calldata', () => {
          const amountIn = CurrencyAmount.fromRawAmount(ETHER, JSBI.BigInt(100))

          const v3Trade = V3Trade.fromRoute(
            new V3Route([pool_1_WETH, pool_0_1], ETHER, token0),
            amountIn,
            TradeType.EXACT_INPUT
          )

          it('array of trades', async () => {
            const trade = await v3Trade
            const trades = [await v3Trade]
            const encodedTrade = encodeMultiHopTrade(
              TradeType.EXACT_INPUT,
              new V3Route([pool_1_WETH, pool_0_1], ETHER, token0),
              recipient,
              trade.maximumAmountIn(slippageTolerance, trade.inputAmount).quotient,
              trade.minimumAmountOut(slippageTolerance, trade.outputAmount).quotient
            )
            const preSignMulticall = EATMulticallExtended.encodePresignMulticallExtended(encodedTrade, deadline)

            const { parameters, calls, value } = await SwapRouter.swapCallParameters(trades, {
              slippageTolerance,
              recipient,
              deadlineOrPreviousBlockhash: deadline,
            })

            expect(calls).toEqual([encodedTrade])
            expect(parameters).toEqual(preSignMulticall.parameters)
            expect(value).toBe('0x64')
          })

          it('meta-trade', async () => {
            const trade = await v3Trade
            const trades = await Trade.fromRoutes(
              [
                {
                  routev3: trade.swaps[0].route,
                  amount: amountIn,
                },
              ],
              TradeType.EXACT_INPUT
            )

            const encodedTrade = encodeMultiHopTrade(
              TradeType.EXACT_INPUT,
              new V3Route([pool_1_WETH, pool_0_1], ETHER, token0),
              recipient,
              trade.maximumAmountIn(slippageTolerance, trade.inputAmount).quotient,
              trade.minimumAmountOut(slippageTolerance, trade.outputAmount).quotient
            )
            const preSignMulticall = EATMulticallExtended.encodePresignMulticallExtended(encodedTrade, deadline)

            const { parameters, calls, value } = await SwapRouter.swapCallParameters(trades, {
              slippageTolerance,
              recipient,
              deadlineOrPreviousBlockhash: deadline,
            })
            expect(calls).toEqual([encodedTrade])
            expect(parameters).toEqual(preSignMulticall.parameters)
            expect(value).toBe('0x64')
          })
        })
      })

      describe('multi-hop exact output (v3)', () => {
        describe('different trade configurations result in identical calldata', () => {
          // Append refund ETH
          const amountOut = CurrencyAmount.fromRawAmount(token0, JSBI.BigInt(100))

          const v3Trade = V3Trade.fromRoute(
            new V3Route([pool_1_WETH, pool_0_1], ETHER, token0),
            amountOut,
            TradeType.EXACT_OUTPUT
          )

          it('array of trades', async () => {
            const trade = await v3Trade
            const trades = [await v3Trade]

            const encodedTrade = encodeMultiHopTrade(
              TradeType.EXACT_OUTPUT,
              new V3Route([pool_1_WETH, pool_0_1], ETHER, token0),
              recipient,
              trade.minimumAmountOut(slippageTolerance, trade.outputAmount).quotient,
              trade.maximumAmountIn(slippageTolerance, trade.inputAmount).quotient
            )
            const expectedCalls = [encodedTrade, REFUND_ETH_FUNC_SIG]
            const preSignMulticall = EATMulticallExtended.encodePresignMulticallExtended(expectedCalls, deadline)

            const { parameters, calls, value } = await SwapRouter.swapCallParameters(trades, {
              slippageTolerance,
              recipient,
              deadlineOrPreviousBlockhash: deadline,
            })
            expect(calls).toEqual(expectedCalls)
            expect(parameters).toEqual(preSignMulticall.parameters)
            expect(value).toBe('0x69')
          })

          it('meta-trade', async () => {
            const trade = await v3Trade
            const trades = await Trade.fromRoutes(
              [
                {
                  routev3: trade.swaps[0].route,
                  amount: amountOut,
                },
              ],
              TradeType.EXACT_OUTPUT
            )

            const encodedTrade = encodeMultiHopTrade(
              TradeType.EXACT_OUTPUT,
              new V3Route([pool_1_WETH, pool_0_1], ETHER, token0),
              recipient,
              trade.minimumAmountOut(slippageTolerance, trade.outputAmount).quotient,
              trade.maximumAmountIn(slippageTolerance, trade.inputAmount).quotient
            )
            const expectedCalls = [encodedTrade, REFUND_ETH_FUNC_SIG]
            const preSignMulticall = EATMulticallExtended.encodePresignMulticallExtended(expectedCalls, deadline)

            const { parameters, calls, value } = await SwapRouter.swapCallParameters(trades, {
              slippageTolerance,
              recipient,
              deadlineOrPreviousBlockhash: deadline,
            })

            expect(calls).toEqual(expectedCalls)
            expect(parameters).toEqual(preSignMulticall.parameters)
            expect(value).toBe('0x69')
          })
        })
      })

      describe('high price impact with ETH input to result in refundETH being appended to calldata', () => {
        // Append refund ETH
        const amountIn = CurrencyAmount.fromRawAmount(ETHER, JSBI.BigInt(100))
        const pool_1_WETH_slippage = makePool(token1, WETH, 100)
        const REFUND_ETH_FUNCTION_SIG = /12210e8a/

        const v3Trade = V3Trade.fromRoute(
          new V3Route([pool_1_WETH_slippage], ETHER, token1),
          amountIn,
          TradeType.EXACT_INPUT
        )

        it('array of trades', async () => {
          const trade = await v3Trade
          const trades = [trade]
          const encodedTrade = encodeTrade(
            'exactInputSingle',
            WETH,
            token1,
            pool_0_1,
            recipient,
            trade.maximumAmountIn(slippageTolerance, trade.inputAmount).quotient,
            trade.minimumAmountOut(slippageTolerance, trade.outputAmount).quotient
          )
          const expectedCalls = [encodedTrade, REFUND_ETH_FUNC_SIG]
          const preSignMulticall = EATMulticallExtended.encodePresignMulticallExtended(expectedCalls, deadline)

          const { parameters, calls, value } = await SwapRouter.swapCallParameters(trades, {
            slippageTolerance,
            recipient,
            deadlineOrPreviousBlockhash: deadline,
          })
          expect(parameters).toEqual(preSignMulticall.parameters)
          expect(calls).toEqual(expectedCalls)
          expect(parameters).toMatch(REFUND_ETH_FUNCTION_SIG)
          expect(value).toBe('0x64')
        })
      })

      describe('high price impact with ERCO20 input does not result in refundETH call', () => {
        const amountIn = CurrencyAmount.fromRawAmount(token1, JSBI.BigInt(100))
        const pool_1_WETH_slippage = makePool(token1, WETH, 100)
        const REFUND_ETH_FUNCTION_SIG = /12210e8a/

        const v3Trade = V3Trade.fromRoute(
          new V3Route([pool_1_WETH_slippage], token1, WETH),
          amountIn,
          TradeType.EXACT_INPUT
        )

        it('array of trades', async () => {
          const trade = await v3Trade
          const trades = [trade]
          const encodedTrade = encodeTrade(
            'exactInputSingle',
            token1,
            WETH,
            pool_0_1,
            recipient,
            trade.maximumAmountIn(slippageTolerance, trade.inputAmount).quotient,
            trade.minimumAmountOut(slippageTolerance, trade.outputAmount).quotient
          )
          const preSignMulticall = EATMulticallExtended.encodePresignMulticallExtended(encodedTrade, deadline)

          const { parameters, calls, value } = await SwapRouter.swapCallParameters(trades, {
            slippageTolerance,
            recipient,
            deadlineOrPreviousBlockhash: deadline,
          })

          expect(parameters).toEqual(preSignMulticall.parameters)
          expect(calls).toEqual([encodedTrade])
          expect(parameters).not.toMatch(REFUND_ETH_FUNCTION_SIG)
          expect(value).toBe('0x00')
        })
      })
    })

    describe('ETH output', () => {
      describe('single-hop exact input (v3)', () => {
        describe('different trade configurations result in identical calldata', () => {
          const amountIn = CurrencyAmount.fromRawAmount(token1, JSBI.BigInt(100))

          const v3Trade = V3Trade.fromRoute(new V3Route([pool_1_WETH], token1, ETHER), amountIn, TradeType.EXACT_INPUT)

          it('array of trades', async () => {
            const trade = await v3Trade
            const trades = [await v3Trade]

            const encodedTrade = encodeTrade(
              'exactInputSingle',
              token1,
              WETH,
              pool_1_WETH,
              ADDRESS_THIS, // router is custodying
              trade.maximumAmountIn(slippageTolerance, trade.inputAmount).quotient,
              trade.minimumAmountOut(slippageTolerance, trade.outputAmount).quotient
            )
            const encodedUnwrap = PaymentsExtended.encodeUnwrapWETH9(
              trade.minimumAmountOut(slippageTolerance, trade.outputAmount).quotient,
              recipient
            )
            const expectedCalls = [encodedTrade, encodedUnwrap]
            const preSignMulticall = EATMulticallExtended.encodePresignMulticallExtended(expectedCalls, deadline)

            const { parameters, calls, value } = await SwapRouter.swapCallParameters(trades, {
              slippageTolerance,
              recipient,
              deadlineOrPreviousBlockhash: deadline,
            })

            expect(calls).toEqual(expectedCalls)
            expect(parameters).toEqual(preSignMulticall.parameters)
            expect(value).toBe('0x00')
          })

          it('meta-trade', async () => {
            const trade = await v3Trade
            const trades = await Trade.fromRoutes(
              [
                {
                  routev3: trade.swaps[0].route,
                  amount: amountIn,
                },
              ],
              TradeType.EXACT_INPUT
            )

            const encodedTrade = encodeTrade(
              'exactInputSingle',
              token1,
              WETH,
              pool_1_WETH,
              ADDRESS_THIS, // router is custodying
              trade.maximumAmountIn(slippageTolerance, trade.inputAmount).quotient,
              trade.minimumAmountOut(slippageTolerance, trade.outputAmount).quotient
            )
            const encodedUnwrap = PaymentsExtended.encodeUnwrapWETH9(
              trade.minimumAmountOut(slippageTolerance, trade.outputAmount).quotient,
              recipient
            )
            const expectedCalls = [encodedTrade, encodedUnwrap]
            const preSignMulticall = EATMulticallExtended.encodePresignMulticallExtended(expectedCalls, deadline)

            const { parameters, calls, value } = await SwapRouter.swapCallParameters(trades, {
              slippageTolerance,
              recipient,
              deadlineOrPreviousBlockhash: deadline,
            })

            expect(calls).toEqual(expectedCalls)
            expect(parameters).toEqual(preSignMulticall.parameters)
            expect(value).toBe('0x00')
          })
        })
      })

      describe('single-hop exact output (v3)', () => {
        describe('different trade configurations result in identical calldata', () => {
          const amountOut = CurrencyAmount.fromRawAmount(ETHER, JSBI.BigInt(100))

          const v3Trade = V3Trade.fromRoute(
            new V3Route([pool_1_WETH], token1, ETHER),
            amountOut,
            TradeType.EXACT_OUTPUT
          )

          it('array of trades', async () => {
            const trade = await v3Trade
            const trades = [await v3Trade]

            const encodedTrade = encodeTrade(
              'exactOutputSingle',
              token1,
              WETH,
              pool_1_WETH,
              ADDRESS_THIS, // router is custodying
              trade.minimumAmountOut(slippageTolerance, trade.outputAmount).quotient,
              trade.maximumAmountIn(slippageTolerance, trade.inputAmount).quotient
            )
            const encodedUnwrap = PaymentsExtended.encodeUnwrapWETH9(
              trade.minimumAmountOut(slippageTolerance, trade.outputAmount).quotient,
              recipient
            )
            const expectedCalls = [encodedTrade, encodedUnwrap]
            const preSignMulticall = EATMulticallExtended.encodePresignMulticallExtended(expectedCalls, deadline)

            const { parameters, calls, value } = await SwapRouter.swapCallParameters(trades, {
              slippageTolerance,
              recipient,
              deadlineOrPreviousBlockhash: deadline,
            })

            expect(calls).toEqual(expectedCalls)
            expect(parameters).toEqual(preSignMulticall.parameters)
            expect(value).toBe('0x00')
          })

          it('meta-trade', async () => {
            const trade = await v3Trade
            const trades = await Trade.fromRoutes(
              [
                {
                  routev3: trade.swaps[0].route,
                  amount: amountOut,
                },
              ],
              TradeType.EXACT_OUTPUT
            )

            const encodedTrade = encodeTrade(
              'exactOutputSingle',
              token1,
              WETH,
              pool_1_WETH,
              ADDRESS_THIS, // router is custodying
              trade.minimumAmountOut(slippageTolerance, trade.outputAmount).quotient,
              trade.maximumAmountIn(slippageTolerance, trade.inputAmount).quotient
            )
            const encodedUnwrap = PaymentsExtended.encodeUnwrapWETH9(
              trade.minimumAmountOut(slippageTolerance, trade.outputAmount).quotient,
              recipient
            )
            const expectedCalls = [encodedTrade, encodedUnwrap]
            const preSignMulticall = EATMulticallExtended.encodePresignMulticallExtended(expectedCalls, deadline)
            const { parameters, calls, value } = await SwapRouter.swapCallParameters(trades, {
              slippageTolerance,
              recipient,
              deadlineOrPreviousBlockhash: deadline,
            })
            expect(calls).toEqual(expectedCalls)
            expect(parameters).toEqual(preSignMulticall.parameters)
            expect(value).toBe('0x00')
          })
        })
      })

      describe('multi-hop exact input (v3)', () => {
        describe('different trade configurations result in identical calldata', () => {
          const amountIn = CurrencyAmount.fromRawAmount(token0, JSBI.BigInt(100))

          const v3Trade = V3Trade.fromRoute(
            new V3Route([pool_0_1, pool_1_WETH], token0, ETHER),
            amountIn,
            TradeType.EXACT_INPUT
          )

          it('array of trades', async () => {
            const trade = await v3Trade
            const trades = [trade]
            const encodedTrade = encodeMultiHopTrade(
              TradeType.EXACT_INPUT,
              new V3Route([pool_0_1, pool_1_WETH], token0, ETHER),
              ADDRESS_THIS, // router is custodying
              trade.maximumAmountIn(slippageTolerance, trade.inputAmount).quotient,
              trade.minimumAmountOut(slippageTolerance, trade.outputAmount).quotient
            )
            const encodedUnwrap = PaymentsExtended.encodeUnwrapWETH9(
              trade.minimumAmountOut(slippageTolerance, trade.outputAmount).quotient,
              recipient
            )
            const expectedCalls = [encodedTrade, encodedUnwrap]
            const preSignMulticall = EATMulticallExtended.encodePresignMulticallExtended(expectedCalls, deadline)

            const { parameters, calls, value } = await SwapRouter.swapCallParameters(trades, {
              slippageTolerance,
              recipient,
              deadlineOrPreviousBlockhash: deadline,
            })
            expect(calls).toEqual(expectedCalls)
            expect(parameters).toEqual(preSignMulticall.parameters)
            expect(value).toBe('0x00')
          })

          it('meta-trade', async () => {
            const trade = await v3Trade
            const trades = await Trade.fromRoutes(
              [
                {
                  routev3: trade.swaps[0].route,
                  amount: amountIn,
                },
              ],
              TradeType.EXACT_INPUT
            )

            const encodedTrade = encodeMultiHopTrade(
              TradeType.EXACT_INPUT,
              new V3Route([pool_0_1, pool_1_WETH], token0, ETHER),
              ADDRESS_THIS, // router is custodying
              trade.maximumAmountIn(slippageTolerance, trade.inputAmount).quotient,
              trade.minimumAmountOut(slippageTolerance, trade.outputAmount).quotient
            )
            const encodedUnwrap = PaymentsExtended.encodeUnwrapWETH9(
              trade.minimumAmountOut(slippageTolerance, trade.outputAmount).quotient,
              recipient
            )
            const expectedCalls = [encodedTrade, encodedUnwrap]
            const preSignMulticall = EATMulticallExtended.encodePresignMulticallExtended(expectedCalls, deadline)

            const { parameters, calls, value } = await SwapRouter.swapCallParameters(trades, {
              slippageTolerance,
              recipient,
              deadlineOrPreviousBlockhash: deadline,
            })

            expect(calls).toEqual(expectedCalls)
            expect(parameters).toEqual(preSignMulticall.parameters)
            expect(value).toBe('0x00')
          })

          // it('meta-trade with mixedRoute produces same calldata but in different order', async () => {
          //   const expectedCalldata =
          //     '0x5ae401dc000000000000000000000000000000000000000000000000000000000000007b00000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000003000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000001c000000000000000000000000000000000000000000000000000000000000003000000000000000000000000000000000000000000000000000000000000000124b858183f0000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000008000000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000064000000000000000000000000000000000000000000000000000000000000005f00000000000000000000000000000000000000000000000000000000000000420000000000000000000000000000000000000001000bb80000000000000000000000000000000000000002000bb8c02aaa39b223fe8d0a0e5c4f27ead9083c756cc2000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000104472b43f30000000000000000000000000000000000000000000000000000000000000064000000000000000000000000000000000000000000000000000000000000006100000000000000000000000000000000000000000000000000000000000000800000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000300000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000002000000000000000000000000c02aaa39b223fe8d0a0e5c4f27ead9083c756cc200000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000004449404b7c00000000000000000000000000000000000000000000000000000000000000c0000000000000000000000000000000000000000000000000000000000000000300000000000000000000000000000000000000000000000000000000'
          //   const trades = await Trade.fromRoutes(
          //     [],
          //     [
          //       {
          //         routev3: (await v3Trade).swaps[0].route,
          //         amount: amountIn,
          //       },
          //     ],
          //     TradeType.EXACT_INPUT,
          //     [
          //       {
          //         mixedRoute: (await mixedRouteTrade).swaps[0].route,
          //         amount: amountIn,
          //       },
          //     ]
          //   )

          //   const { parameters, calls, value } = await SwapRouter.swapCallParameters(trades, {
          //     slippageTolerance,
          //     recipient,
          //     deadlineOrPreviousBlockhash: deadline,
          //   })
          //   expect(calls).toEqual([encodedTrade])
          //   expect(value).toBe('0x00')
          // })
        })
      })

      describe('multi-hop exact output (v3)', () => {
        describe('different trade configurations result in identical calldata', () => {
          const amountOut = CurrencyAmount.fromRawAmount(ETHER, JSBI.BigInt(100))

          const v3Trade = V3Trade.fromRoute(
            new V3Route([pool_0_1, pool_1_WETH], token0, ETHER),
            amountOut,
            TradeType.EXACT_OUTPUT
          )

          it('array of trades', async () => {
            const trade = await v3Trade
            const trades = [trade]

            const encodedTrade = encodeMultiHopTrade(
              TradeType.EXACT_OUTPUT,
              new V3Route([pool_0_1, pool_1_WETH], token0, ETHER),
              ADDRESS_THIS, // router is custodying
              trade.minimumAmountOut(slippageTolerance, trade.outputAmount).quotient,
              trade.maximumAmountIn(slippageTolerance, trade.inputAmount).quotient
            )
            const encodedUnwrap = PaymentsExtended.encodeUnwrapWETH9(
              trade.minimumAmountOut(slippageTolerance, trade.outputAmount).quotient,
              recipient
            )
            const expectedCalls = [encodedTrade, encodedUnwrap]
            const preSignMulticall = EATMulticallExtended.encodePresignMulticallExtended(expectedCalls, deadline)

            const { parameters, calls, value } = await SwapRouter.swapCallParameters(trades, {
              slippageTolerance,
              recipient,
              deadlineOrPreviousBlockhash: deadline,
            })

            expect(calls).toEqual(expectedCalls)
            expect(parameters).toEqual(preSignMulticall.parameters)
            expect(value).toBe('0x00')
          })

          it('meta-trade', async () => {
            const trade = await v3Trade
            const trades = await Trade.fromRoutes(
              [
                {
                  routev3: trade.swaps[0].route,
                  amount: amountOut,
                },
              ],
              TradeType.EXACT_OUTPUT
            )

            const encodedTrade = encodeMultiHopTrade(
              TradeType.EXACT_OUTPUT,
              new V3Route([pool_0_1, pool_1_WETH], token0, ETHER),
              ADDRESS_THIS, // router is custodying
              trade.minimumAmountOut(slippageTolerance, trade.outputAmount).quotient,
              trade.maximumAmountIn(slippageTolerance, trade.inputAmount).quotient
            )
            const encodedUnwrap = PaymentsExtended.encodeUnwrapWETH9(
              trade.minimumAmountOut(slippageTolerance, trade.outputAmount).quotient,
              recipient
            )
            const expectedCalls = [encodedTrade, encodedUnwrap]
            const preSignMulticall = EATMulticallExtended.encodePresignMulticallExtended(expectedCalls, deadline)

            const { parameters, calls, value } = await SwapRouter.swapCallParameters(trades, {
              slippageTolerance,
              recipient,
              deadlineOrPreviousBlockhash: deadline,
            })

            expect(calls).toEqual(expectedCalls)
            expect(parameters).toEqual(preSignMulticall.parameters)
            expect(value).toBe('0x00')
          })
        })
      })
    })
  })
})
