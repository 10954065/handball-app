import type { WebContents } from 'electron'
import type { ChannelName, ChannelOutput, ChannelParsed } from '@shared/ipc/contract'
import type { AppContext } from '../context'
import type { Ctx } from '../services/ctx'

export interface RequestContext extends Ctx {
  app: AppContext
  sender: WebContents
}

export type Handler<K extends ChannelName> = (
  input: ChannelParsed<K>,
  ctx: RequestContext
) => ChannelOutput<K> | Promise<ChannelOutput<K>>

export type HandlerMap = { [K in ChannelName]: Handler<K> }
