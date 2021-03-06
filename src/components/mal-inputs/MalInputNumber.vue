<template>
	<div class="MalInputNumber">
		<MalExpButton
			class="MalInputNumber__exp-button"
			v-if="display.isExp && compact"
			:value="value"
			:compact="true"
			@select="$emit('select', $event)"
		/>
		<InputNumber
			:class="{
				exp: display.isExp,
			}"
			:value="displayValue"
			@input="onInput"
			@end-tweak="$emit('end-tweak', $event)"
		/>
		<span
			class="MalInputNumber__unit"
			:class="{small: display.unit && display.unit.length >= 2}"
			v-if="display.mode === 'unit'"
		>{{ display.unit }}</span>
		<MalExpButton
			class="MalInputNumber__exp-after"
			v-if="display.isExp && !compact"
			:value="value"
			:compact="false"
			@select="$emit('select', $event)"
		/>
	</div>
</template>

<script lang="ts">
import {defineComponent, computed, SetupContext} from '@vue/composition-api'
import InputNumber from '@/components/inputs/InputNumber.vue'
import MalExpButton from '@/components/mal-inputs/MalExpButton.vue'
import {
	MalSeq,
	isList,
	MalVal,
	MalSymbol,
	getEvaluated,
	MalType,
	createList as L,
	keywordFor as K,
	MalFunc,
} from '@/mal/types'
import {getMapValue, getFnInfo, reverseEval, getFn} from '@/mal/utils'
import {NonReactive, nonReactive} from '@/utils'
import {readStr} from '@/mal'

interface Props {
	value: NonReactive<MalSymbol | number | MalSeq>
	validator?: (v: number) => number | null
	compact: boolean
}

export default defineComponent({
	name: 'MalInputNumber',
	components: {InputNumber, MalExpButton},
	props: {
		value: {
			required: true,
			validator: x => x instanceof NonReactive,
		},
		validator: {
			type: Function,
			required: false,
		},
		compact: {
			type: Boolean,
			default: false,
		},
	},
	setup(props: Props, context: SetupContext) {
		const display = computed(() => {
			if (typeof props.value.value === 'number') {
				return {mode: 'number', isExp: false}
			} else if (isList(props.value.value) && props.value.value.length === 2) {
				const info = getFnInfo(props.value.value)

				if (info) {
					const inverseFn = getMapValue(info.meta, 'inverse', MalType.Function)
					const unit = getMapValue(info.meta, 'unit', MalType.String)

					if (inverseFn && unit) {
						const isExp = typeof (props.value.value as MalVal[])[1] !== 'number'
						return {mode: 'unit', unit, inverseFn, isExp}
					}
				}
			}
			return {mode: 'exp', isExp: true}
		})

		const fn = computed(() => {
			if (display.value.mode !== 'exp') {
				return getFn(props.value.value)
			} else {
				return undefined
			}
		})

		const displayValue = computed(() => {
			switch (display.value.mode) {
				case 'number':
					return props.value.value as number
				case 'unit':
					return getEvaluated((props.value.value as MalVal[])[1]) as number
				default:
					// exp
					return getEvaluated(props.value.value) as number
			}
		})

		function onInput(value: number | string) {
			let newExp: MalVal = value

			// Parse if necessary
			if (typeof value === 'string') {
				let ret
				try {
					ret = readStr(value)
				} catch (e) {
					return
				}
				newExp = ret
			}

			// Validate
			if (props.validator && typeof value === 'number') {
				let validated
				if (display.value.mode === 'unit') {
					const unitValue = (fn.value as any)(value as any)
					validated = (display.value.inverseFn as any)({
						[K('return')]: props.validator(unitValue),
					})[0]
				} else {
					validated = props.validator(value)
				}
				if (typeof validated === 'number') {
					newExp = validated
				}
			}

			// Reverse evaluation
			if (display.value.mode === 'unit') {
				const unitValue =
					typeof newExp === 'number'
						? reverseEval(newExp, (props.value.value as MalVal[])[1])
						: newExp
				newExp = L((props.value.value as MalVal[])[0], unitValue)
			} else if (display.value.mode === 'exp') {
				newExp =
					typeof newExp === 'number'
						? reverseEval(newExp, props.value.value)
						: newExp
			}

			context.emit('input', nonReactive(newExp))
		}

		return {
			displayValue,
			display,
			onInput,
		}
	},
})
</script>

<style lang="stylus">
@import '../style/common.styl'

.MalInputNumber
	position relative
	display flex
	align-items center
	line-height $input-height

	&__exp-button
		position absolute
		left 0.4rem
		z-index 200

	&__unit
		padding-left 0.3em
		width 1rem
		color var(--comment)

		&.small
			height $input-height
			letter-spacing 0
			font-size 0.8em
			line-height $input-height * 1.2

	&__exp-after
		margin-left 0.3rem
</style>
