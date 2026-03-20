import React, { useState, useRef } from 'react';
import {
  View, TextInput, Text, Animated, StyleSheet,
  TextInputProps, ViewStyle, TouchableWithoutFeedback,
} from 'react-native';
import { colors, layout, text } from '../../theme';

interface InputProps extends TextInputProps {
  label: string;
  error?: string;
  containerStyle?: ViewStyle;
}

export function FloatingInput({ label, error, containerStyle, ...props }: InputProps) {
  const [focused, setFocused] = useState(false);
  const labelAnim = useRef(new Animated.Value(props.value ? 1 : 0)).current;
  const inputRef = useRef<TextInput>(null);

  const hasValue = !!(props.value && props.value.length > 0);
  const elevated = focused || hasValue;

  const animateLabel = (toValue: number) => {
    Animated.timing(labelAnim, {
      toValue, duration: 180, useNativeDriver: false,
    }).start();
  };

  return (
    <TouchableWithoutFeedback onPress={() => inputRef.current?.focus()}>
      <View style={[styles.container, containerStyle]}>
        <View style={[
          styles.inputWrap,
          focused && styles.inputFocused,
          !!error && styles.inputError,
        ]}>
          <Animated.Text style={[
            styles.label,
            {
              top: labelAnim.interpolate({ inputRange: [0, 1], outputRange: [18, 7] }),
              fontSize: labelAnim.interpolate({ inputRange: [0, 1], outputRange: [15, 11] }),
              color: focused
                ? colors.teal[400]
                : error
                  ? colors.error
                  : colors.neutral[500],
            },
          ]}>
            {label}
          </Animated.Text>
          <TextInput
            ref={inputRef}
            style={styles.input}
            onFocus={() => { setFocused(true); animateLabel(1); }}
            onBlur={() => { setFocused(false); if (!hasValue) animateLabel(0); }}
            placeholderTextColor="transparent"
            autoCapitalize="none"
            {...props}
          />
        </View>
        {!!error && <Text style={styles.errorText}>{error}</Text>}
      </View>
    </TouchableWithoutFeedback>
  );
}

const styles = StyleSheet.create({
  container: { marginBottom: 16 },
  inputWrap: {
    height: 56,
    backgroundColor: colors.bg.white,
    borderRadius: layout.inputRadius,
    borderWidth: 1.5,
    borderColor: colors.bg.tertiary,
    paddingHorizontal: 16,
    justifyContent: 'flex-end',
    paddingBottom: 8,
  },
  inputFocused: { borderColor: colors.teal[400] },
  inputError: { borderColor: colors.error },
  label: {
    position: 'absolute',
    left: 16,
    fontFamily: 'DMSans_400Regular',
    letterSpacing: 0.3,
  },
  input: {
    ...text.bodyMd,
    color: colors.primary[800],
    paddingTop: 10,
    height: 36,
  },
  errorText: {
    ...text.caption,
    color: colors.error,
    marginTop: 4,
    marginLeft: 4,
  },
});
