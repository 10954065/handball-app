import { BrowserWindow, dialog } from 'electron'
import { AppError } from '@shared/errors'
import { z } from 'zod'
import { usbDevicesSchema, visionModelSchema, type ShirtsDTO, type UsbDevice } from '@shared/vision'
import { cameraSpec, createCamera, deleteCamera, listCameras, updateCamera } from '../../services/cameras'
import type { Ctx } from '../../services/ctx'
import { feeds, secrets, vision } from '../../vision/instance'
import type { HandlerMap } from '../types'

const VIDEO_EXTENSIONS = ['mp4', 'mkv', 'avi', 'mov', 'webm']

/** For this session only. Kits change from one match to the next. */
let shirts: ShirtsDTO = {}

async function ensureRunning(): Promise<void> {
  await vision.start()
  const { state, message } = vision.status()
  if (state !== 'running') throw new AppError('CONFLICT', message ?? 'The AI service is not running.')
}

async function usbDevices(): Promise<UsbDevice[]> {
  await ensureRunning()
  return usbDevicesSchema.parse(await vision.request('cameras.discover'))
}

async function openCamera(ctx: Ctx, id: string): Promise<void> {
  await feeds.open(cameraSpec(ctx, secrets, id, await usbDevices()))
}

export const visionHandlers = {
  'vision.status': () => vision.status(),
  'vision.start': async () => {
    await vision.start()
    return vision.status()
  },
  'vision.stop': async () => {
    await vision.stop()
    return vision.status()
  },
  'vision.discover': () => usbDevices(),
  'vision.feeds': () => feeds.states(),
  'vision.openCamera': ({ id }, ctx) => openCamera(ctx, id),
  'vision.closeCamera': ({ id }) => feeds.close(id),
  'vision.analysis': () => feeds.analysis(),
  'vision.startAnalysis': async ({ rate }) => {
    await ensureRunning()
    await vision.request('analysis.start', { rate, shirts })
  },
  'vision.shirts': () => shirts,
  'vision.setShirts': async (input) => {
    shirts = input
    if (feeds.analysis().state !== 'stopped') await vision.request('analysis.shirts', { shirts })
  },
  'vision.stopAnalysis': async () => {
    await vision.request('analysis.stop')
  },
  'vision.pauseAnalysis': async ({ paused }) => {
    await vision.request('analysis.pause', { paused })
  },
  'vision.models': async () => {
    await ensureRunning()
    return z.array(visionModelSchema).parse(await vision.request('models.list'))
  },
  'cameras.list': (_i, ctx) => listCameras(ctx),
  'cameras.create': (input, ctx) => createCamera(ctx, secrets, input),
  'cameras.update': (input, ctx) => updateCamera(ctx, secrets, input),
  'cameras.delete': async ({ id }, ctx) => {
    await feeds.close(id)
    deleteCamera(ctx, id)
  },
  'cameras.chooseVideo': async (_i, ctx) => {
    const options = { title: 'Choose a match video', properties: ['openFile' as const], filters: [{ name: 'Video', extensions: VIDEO_EXTENSIONS }] }
    const parent = BrowserWindow.fromWebContents(ctx.sender)
    const res = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options)
    return res.canceled || !res.filePaths[0] ? null : { path: res.filePaths[0] }
  }
} satisfies Partial<HandlerMap>
