// Copyright (C) 2018, Zpalmtree
//
// Please see the included LICENSE file for more information.

import * as React from 'react';

import { Animated, StyleSheet } from 'react-native';

import { ListItem as RneListItem, ListItemProps } from 'react-native-elements';

import { legacyRNElementsColors } from './Styles';
import { haptic, usePressScale } from './Feedback';

const styles = StyleSheet.create({
    listItemContainer: {
        paddingTop: 10,
        paddingRight: 10,
        paddingBottom: 10,
        borderBottomColor: legacyRNElementsColors.greyOutline,
        borderBottomWidth: 1,
        backgroundColor: "transparent",
    },
});

/* https://github.com/react-native-training/react-native-elements/issues/1565 */
/* Tappable rows get a subtle press-scale and a selection tick. */
const ListItem = props => {
    const press = usePressScale(0.98);
    if (!props.onPress) {
        return (
            <RneListItem
                containerStyle={[styles.listItemContainer, props.containerStyle]}
                underlayColor='transparent'
                {...props}
            />
        );
    }
    const { onPress } = props;
    return (
        <Animated.View style={press.style}>
            <RneListItem
                containerStyle={[styles.listItemContainer, props.containerStyle]}
                underlayColor='transparent'
                {...props}
                onPressIn={press.onPressIn}
                onPressOut={press.onPressOut}
                onPress={(...a) => { haptic('selection'); onPress(...a); }}
            />
        </Animated.View>
    );
};

export default ListItem;
