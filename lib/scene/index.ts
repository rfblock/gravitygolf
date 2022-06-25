import { goto } from '$app/navigation'

import type Position from '$lib/position'
import type Level from '$lib/level'
import type Force from './force'
import type Ball from './ball'
import type Hole from './hole'
import type Star from './star'
import type Wall from './wall'
import EventDispatcher from '$lib/event/dispatcher'
import FORCE_RADIUS from './force/radius'
import levels from '$lib/level/levels.json'
import distance from './distance'
import clear from './clear'
import normalizePoint from './normalize/point'
import normalizeShape from './normalize/shape'
import collision from './collision'
import scale from './transform/scale'
import resize from './transform/resize'
import distanceSquared from './distance/squared'
import splitHypotenuse from './split/hypotenuse'
import clamp from './clamp'
import useImage from '$lib/image/use'

import gravityImage from '../../images/ball.png'
import antigravityImage from '../../images/ball.png'
import ballImage from '../../images/ball.png'
import holeImage from '../../images/ball.png'
import starImage from '../../images/star.png'

const MAX_DISTANCE = 800
const MAX_VELOCITY = 500

interface Events {
	forces: [number, number]
}

export default class Scene extends EventDispatcher<Events> {
	private previousTime: number | null = null
	private frame: number | null = null

	private center = { x: 0, y: 0 }

	private mouseStart: (Position & { button: number }) | null = null
	private mouseCurrent: (Position & { force: Force | null }) | null = null

	private hit = false

	private forces: Force[] = undefined as never
	private ball: Ball = undefined as never
	private hole: Hole = undefined as never
	private stars: Star[] = undefined as never
	private walls: Wall[] = undefined as never

	constructor(
		private readonly canvas: HTMLCanvasElement,
		private readonly context: CanvasRenderingContext2D,
		private readonly level: Level & { id: number }
	) {
		super()

		this.clear()

		this.hole = { ...level.hole, image: useImage(holeImage) }
		this.stars = level.stars.map(star => ({
			...star,
			image: useImage(starImage)
		}))
		this.walls = level.walls

		this.scale()

		this.resize()
		window.addEventListener('resize', this.resize)

		document.addEventListener('keydown', this.key)

		this.canvas.addEventListener('mousedown', this.down)
		this.canvas.addEventListener('mousemove', this.move)
		this.canvas.addEventListener('mouseup', this.up)

		this.canvas.addEventListener('contextmenu', this.rightClick)

		this.frame = requestAnimationFrame(this.tick)
	}

	private readonly scale = () => scale(this.context)
	private readonly resize = () => resize(this.canvas)

	private readonly tick = (currentTime: number) => {
		this.frame = null

		currentTime /= 1000

		const delta = currentTime - (this.previousTime || currentTime)
		this.previousTime = currentTime

		if (this.hit) {
			if (
				distance(
					normalizePoint(this.ball, this.canvas, this.center),
					normalizePoint(this.hole, this.canvas, this.center)
				) <=
				this.hole.radius - this.ball.radius
			) {
				alert('Congratulations!')

				const lastLevel = this.level.id === levels.length
				const suffix = lastLevel ? '' : `/${this.level.id + 1}`

				goto(`/levels${suffix}`).catch(({ message }) => alert(message))

				return
			}

			for (const wall of this.walls) {
				const angle = collision(
					normalizePoint(this.ball, this.canvas, this.center),
					normalizeShape(wall, this.canvas, this.center)
				)

				if (angle !== null) {
					const v = Math.atan2(-this.ball.vy, this.ball.vx)

					const bounceAngle = 2 * angle - v + Math.PI
					const speed = Math.sqrt(this.ball.vy ** 2 + this.ball.vx ** 2)

					this.ball.vy = -Math.sin(bounceAngle) * speed
					this.ball.vx = Math.cos(bounceAngle) * speed
				}
			}

			for (const force of this.forces) {
				const rSquared = distanceSquared(
					normalizePoint(this.ball, this.canvas, this.center),
					normalizePoint(force, this.canvas, this.center)
				)

				const { x, y } = splitHypotenuse(
					normalizePoint(force, this.canvas, this.center),
					normalizePoint(this.ball, this.canvas, this.center),
					Math.sqrt(rSquared),
					clamp(-5000, 5000, (force.direction * 100000000) / rSquared)
				)

				this.ball.vx += x * delta
				this.ball.vy += y * delta
			}
		}

		this.ball.x += this.ball.vx * delta
		this.ball.y -= this.ball.vy * delta

		clear(this.canvas, this.context)

		// ball

		const normalizedBall = normalizeShape(this.ball, this.canvas, this.center)

		if (this.ball.image.current)
			this.context.drawImage(
				this.ball.image.current,
				normalizedBall.x,
				normalizedBall.y,
				normalizedBall.radius * 2,
				normalizedBall.radius * 2
			)

		// hole

		const normalizedHole = normalizeShape(this.hole, this.canvas, this.center)

		if (this.hole.image.current)
			this.context.drawImage(
				this.hole.image.current,
				normalizedHole.x,
				normalizedHole.y,
				normalizedHole.radius * 2,
				normalizedHole.radius * 2
			)

		// stars

		for (const star of this.stars) {
			if (!star.image.current) continue

			const { x, y, radius } = normalizeShape(star, this.canvas, this.center)
			this.context.drawImage(star.image.current, x, y, radius * 2, radius * 2)
		}

		// walls

		for (const wall of this.walls) {
			const { x, y, width, height } = normalizeShape(
				wall,
				this.canvas,
				this.center
			)

			this.context.fillStyle = 'white'
			this.context.fillRect(x, y, width, height)
		}

		// forces

		for (const force of this.forces) {
			if (!force.image.current) continue

			const { x, y, radius } = normalizeShape(
				{ ...force, radius: FORCE_RADIUS },
				this.canvas,
				this.center
			)

			this.context.drawImage(force.image.current, x, y, radius * 2, radius * 2)
		}

		this.frame = requestAnimationFrame(this.tick)
	}

	private readonly down = ({ offsetX, offsetY, button }: MouseEvent) => {
		const scale = window.devicePixelRatio

		const mouse = {
			x: Math.floor(offsetX * scale),
			y: Math.floor(offsetY * scale)
		}

		this.mouseStart = { x: mouse.x, y: mouse.y, button }

		const force =
			this.forces.find(
				force =>
					distance(normalizePoint(force, this.canvas, this.center), mouse) <=
					FORCE_RADIUS
			) ?? null

		this.mouseCurrent = { ...mouse, force }
	}

	private readonly move = ({ offsetX, offsetY }: MouseEvent) => {
		const scale = window.devicePixelRatio

		const mouse = {
			x: Math.floor(offsetX * scale),
			y: Math.floor(offsetY * scale)
		}

		if (this.mouseStart?.button === 0 && this.mouseCurrent) {
			if (this.mouseCurrent.force) {
				// Dragging force

				this.mouseCurrent.force.x += mouse.x - this.mouseCurrent.x
				this.mouseCurrent.force.y -= mouse.y - this.mouseCurrent.y
			} else {
				// Panning

				this.center.x += mouse.x - this.mouseCurrent.x
				this.center.y -= mouse.y - this.mouseCurrent.y
			}

			this.mouseCurrent.x = mouse.x
			this.mouseCurrent.y = mouse.y
		}

		this.updateCursor(mouse)
	}

	private readonly up = ({ offsetX, offsetY }: MouseEvent) => {
		if (this.hit || !this.mouseStart) return

		const scale = window.devicePixelRatio

		const mouse = {
			x: Math.floor(offsetX * scale),
			y: Math.floor(offsetY * scale)
		}

		if (
			this.mouseStart.button === 0 &&
			mouse.x === this.mouseStart.x &&
			mouse.y === this.mouseStart.y
		) {
			// Hit the ball

			this.hit = true

			const normalizedBall = normalizePoint(this.ball, this.canvas, this.center)
			const distanceFactor = distance(mouse, normalizedBall)

			const { x, y } = splitHypotenuse(
				mouse,
				normalizedBall,
				distanceFactor,
				Math.min(distanceFactor / MAX_DISTANCE, 1) * MAX_VELOCITY
			)

			this.ball.vx = x
			this.ball.vy = y
		} else if (
			this.mouseStart.button === 2 &&
			this.mouseCurrent?.force &&
			this.mouseOnForce(mouse, this.mouseCurrent.force)
		) {
			// Remove force

			const index = this.forces.indexOf(this.mouseCurrent.force)

			if (index >= 0) {
				this.forces.splice(index, 1)
				this.dispatchForces()

				this.updateCursor(mouse)
			}
		}

		this.mouseStart = this.mouseCurrent = null
	}

	private readonly rightClick = (event: MouseEvent) => {
		event.preventDefault()
	}

	private readonly mouseOnForce = (mouse: Position, force: Force) =>
		distance(normalizePoint(force, this.canvas, this.center), mouse) <=
		FORCE_RADIUS

	private readonly updateCursor = (mouse: Position) => {
		this.canvas.style.cursor = this.forces.some(force =>
			this.mouseOnForce(mouse, force)
		)
			? 'move'
			: ''
	}

	private readonly key = ({ key }: KeyboardEvent) => {
		if (key === ' ') this.reset()
	}

	private readonly dispatchForces = () => {
		this.dispatchEvent(
			'forces',
			...this.forces.reduce<[number, number]>(
				(remaining, force) => {
					remaining[force.direction === 1 ? 0 : 1]++
					return remaining
				},
				[0, 0]
			)
		)
	}

	readonly addForce = ({ x, y }: Position, direction: 1 | -1) => {
		const scale = window.devicePixelRatio

		this.forces.push({
			x: x * scale + FORCE_RADIUS - this.canvas.width / 2 - this.center.x,
			y: -y * scale - FORCE_RADIUS + this.canvas.height / 2 - this.center.y,
			direction,
			image: useImage(direction === 1 ? gravityImage : antigravityImage)
		})

		this.dispatchForces()
		this.canvas.style.cursor = 'move'
	}

	readonly reset = () => {
		this.hit = false

		this.ball = {
			...this.level.ball,
			vx: 0,
			vy: 0,
			image: useImage(ballImage)
		}
	}

	readonly clear = () => {
		this.reset()

		this.forces = [
			...this.level.defaultGravity.map(force => ({
				...force,
				direction: 1 as const,
				image: useImage(gravityImage)
			})),
			...this.level.defaultAntigravity.map(force => ({
				...force,
				direction: 1 as const,
				image: useImage(antigravityImage)
			}))
		]

		this.dispatchForces()
	}

	readonly destroy = () => {
		this.removeAllEventListeners()

		window.removeEventListener('resize', this.resize)
		document.removeEventListener('keydown', this.key)

		this.canvas.removeEventListener('mousedown', this.down)
		this.canvas.removeEventListener('mousemove', this.move)
		this.canvas.removeEventListener('mouseup', this.up)

		if (this.frame) cancelAnimationFrame(this.frame)
	}
}
