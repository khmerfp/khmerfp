// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC1155} from "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {AccessControlDefaultAdminRules} from "@openzeppelin/contracts/access/extensions/AccessControlDefaultAdminRules.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

interface ICTFRegistry {
    function getOutcomeSlotCount(bytes32 conditionId) external view returns (uint256);
    function getCollectionId(bytes32 parent, bytes32 conditionId, uint256 indexSet) external view returns (bytes32);
    function getPositionId(address collateral, bytes32 collectionId) external view returns (uint256);
}

// @title KhmerFP Exchange
// @notice A decentralized exchange for KhmerFP outcome tokens and collateral.
contract KhmerFPExchange is EIP712, ReentrancyGuard, AccessControlDefaultAdminRules, Pausable {
    using SafeERC20 for IERC20;

    enum Side {
        BUY,
        SELL
    }

    // @notice an order to buy or sell KhmerFP outcome tokens
    struct Order {
        address maker;
        uint256 tokenId;
        Side side;
        uint256 makerAmount;
        uint256 takerAmount;
        uint256 nonce;
        uint256 expiration;
    }

    bytes32 public constant ORDER_TYPEHASH = keccak256(
        "Order(address maker,uint256 tokenId,uint8 side,uint256 makerAmount,uint256 takerAmount,uint256 nonce,uint256 expiration)"
    );
    uint256 public constant MAX_ORDER_AMOUNT = type(uint128).max;
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
    bytes32 public constant EMERGENCY_ROLE = keccak256("EMERGENCY_ROLE");

    struct Market {
        uint256 yesTokenId;
        uint256 noTokenId;
        bool enabled;
    }
    mapping(bytes32 conditionId => Market) public markets;
    mapping(uint256 tokenId => bytes32 conditionId) public tokenConditions;

    IERC20 public immutable collateral;
    IERC1155 public immutable conditionalTokens;

    mapping(bytes32 orderHash => uint256 outcomeAmount) public filledOutcomeAmount;
    mapping(bytes32 orderHash => uint256 collateralAmount) public filledCollateralAmount;
    mapping(bytes32 orderHash => bool cancelled) public cancelled;

    error ZeroAddress();
    error InvalidOrder();
    error InvalidSignature();
    error OrderExpired();
    error OrderIsCancelled();
    error OrderOverfilled();
    error OrdersNotCompatible();
    error InvalidFillAmount();
    error UnauthorizedCancellation();
    error InsufficientCollateral();
    error InsufficientOutcomeTokens();
    error MissingCollateralAllowance();
    error MissingOutcomeApproval();
    error UnexpectedCollateralTransfer();
    error InvalidMarket();
    error MarketAlreadyRegistered();
    error MarketNotEnabled();

    event MarketRegistered(bytes32 indexed conditionId, uint256 yesTokenId, uint256 noTokenId);
    event MarketStatusChanged(bytes32 indexed conditionId, bool enabled);

    event OrderCancelled(bytes32 indexed orderHash, address indexed maker, uint256 nonce);
    event TradeExecuted(
        bytes32 indexed buyOrderHash,
        bytes32 indexed sellOrderHash,
        uint256 indexed tokenId,
        address buyer,
        address seller,
        uint256 outcomeAmount,
        uint256 collateralAmount
    );

    constructor(address collateral_, address conditionalTokens_)
        EIP712("KhmerFP Exchange", "1")
        AccessControlDefaultAdminRules(1 days, msg.sender)
    {
        if (collateral_ == address(0) || conditionalTokens_ == address(0)) {
            revert ZeroAddress();
        }
        collateral = IERC20(collateral_);
        conditionalTokens = IERC1155(conditionalTokens_);
        _grantRole(EMERGENCY_ROLE, msg.sender);
    }

    function pause() external onlyRole(EMERGENCY_ROLE) { _pause(); }
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) { _unpause(); }

    function registerMarket(bytes32 conditionId, uint256 yesTokenId, uint256 noTokenId)
        external onlyRole(DEFAULT_ADMIN_ROLE)
    {
        if (conditionId == bytes32(0) || yesTokenId == 0 || noTokenId == 0 || yesTokenId == noTokenId) {
            revert InvalidMarket();
        }
        if (markets[conditionId].yesTokenId != 0) revert MarketAlreadyRegistered();
        ICTFRegistry ctf = ICTFRegistry(address(conditionalTokens));
        if (
            ctf.getOutcomeSlotCount(conditionId) != 2
                || yesTokenId != ctf.getPositionId(address(collateral), ctf.getCollectionId(bytes32(0), conditionId, 1))
                || noTokenId != ctf.getPositionId(address(collateral), ctf.getCollectionId(bytes32(0), conditionId, 2))
                || tokenConditions[yesTokenId] != bytes32(0) || tokenConditions[noTokenId] != bytes32(0)
        ) revert InvalidMarket();
        markets[conditionId] = Market(yesTokenId, noTokenId, true);
        tokenConditions[yesTokenId] = conditionId;
        tokenConditions[noTokenId] = conditionId;
        emit MarketRegistered(conditionId, yesTokenId, noTokenId);
    }

    function setMarketEnabled(bytes32 conditionId, bool enabled) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (markets[conditionId].yesTokenId == 0) revert InvalidMarket();
        markets[conditionId].enabled = enabled;
        emit MarketStatusChanged(conditionId, enabled);
    }

    function hashOrder(Order calldata order) public view returns (bytes32) {
        return _hashTypedDataV4(_hashOrderStruct(order));
    }

    function cancelOrder(Order calldata order) external {
        if (msg.sender != order.maker) revert UnauthorizedCancellation();
        bytes32 orderHash = hashOrder(order);
        cancelled[orderHash] = true;
        emit OrderCancelled(orderHash, order.maker, order.nonce);
    }

    function matchOrders(
        Order calldata buy,
        bytes calldata buySignature,
        Order calldata sell,
        bytes calldata sellSignature,
        uint256 outcomeAmount,
        uint256 collateralAmount
    ) external nonReentrant onlyRole(OPERATOR_ROLE) whenNotPaused {
        _validateOrder(buy, Side.BUY, buySignature);
        _validateOrder(sell, Side.SELL, sellSignature);
        if (buy.tokenId != sell.tokenId || buy.maker == sell.maker) revert OrdersNotCompatible();
        bytes32 conditionId = tokenConditions[buy.tokenId];
        if (conditionId == bytes32(0) || !markets[conditionId].enabled) revert MarketNotEnabled();

        // Amounts are bounded to uint128, so both cross-products fit uint256.
        if (buy.makerAmount * sell.makerAmount < sell.takerAmount * buy.takerAmount) {
            revert OrdersNotCompatible();
        }
        if (outcomeAmount == 0) revert InvalidFillAmount();
        // reject oversized fills before multiplying caller-controlled quantities.
        if (outcomeAmount > buy.takerAmount || outcomeAmount > sell.makerAmount) {
            revert OrderOverfilled();
        }

        // the supplied payment/quantity ratio is the explicit execution price.
        if (collateralAmount == 0 || collateralAmount > MAX_ORDER_AMOUNT) {
            revert InvalidFillAmount();
        }
        if (
            collateralAmount * buy.takerAmount > outcomeAmount * buy.makerAmount
                || collateralAmount * sell.makerAmount < outcomeAmount * sell.takerAmount
        ) revert OrdersNotCompatible();

        bytes32 buyHash = hashOrder(buy);
        bytes32 sellHash = hashOrder(sell);
        uint256 newBuyFill = filledOutcomeAmount[buyHash] + outcomeAmount;
        uint256 newSellFill = filledOutcomeAmount[sellHash] + outcomeAmount;
        if (newBuyFill > buy.takerAmount || newSellFill > sell.makerAmount) {
            revert OrderOverfilled();
        }
        uint256 newBuyPayment = filledCollateralAmount[buyHash] + collateralAmount;
        uint256 newSellPayment = filledCollateralAmount[sellHash] + collateralAmount;
        if (newBuyPayment > buy.makerAmount) revert OrderOverfilled();

        if (collateral.balanceOf(buy.maker) < collateralAmount) revert InsufficientCollateral();
        if (collateral.allowance(buy.maker, address(this)) < collateralAmount) {
            revert MissingCollateralAllowance();
        }
        if (conditionalTokens.balanceOf(sell.maker, sell.tokenId) < outcomeAmount) {
            revert InsufficientOutcomeTokens();
        }
        if (!conditionalTokens.isApprovedForAll(sell.maker, address(this))) {
            revert MissingOutcomeApproval();
        }

        filledOutcomeAmount[buyHash] = newBuyFill;
        filledOutcomeAmount[sellHash] = newSellFill;
        filledCollateralAmount[buyHash] = newBuyPayment;
        filledCollateralAmount[sellHash] = newSellPayment;

        uint256 buyerBefore = collateral.balanceOf(buy.maker);
        uint256 sellerBefore = collateral.balanceOf(sell.maker);
        collateral.safeTransferFrom(buy.maker, sell.maker, collateralAmount);
        uint256 buyerAfter = collateral.balanceOf(buy.maker);
        uint256 sellerAfter = collateral.balanceOf(sell.maker);
        // reject transfer fees and tokens that report success without paying.
        if (
            buyerAfter > buyerBefore || buyerBefore - buyerAfter != collateralAmount
                || sellerAfter < sellerBefore || sellerAfter - sellerBefore != collateralAmount
        ) revert UnexpectedCollateralTransfer();
        conditionalTokens.safeTransferFrom(
            sell.maker,
            buy.maker,
            sell.tokenId,
            outcomeAmount,
            ""
        );

        emit TradeExecuted(
            buyHash,
            sellHash,
            sell.tokenId,
            buy.maker,
            sell.maker,
            outcomeAmount,
            collateralAmount
        );
    }

    function _validateOrder(Order calldata order, Side expectedSide, bytes calldata signature)
        private
        view
    {
        if (
            order.maker == address(0) || order.tokenId == 0 || order.side != expectedSide
                || order.makerAmount == 0 || order.takerAmount == 0
                || order.makerAmount > MAX_ORDER_AMOUNT || order.takerAmount > MAX_ORDER_AMOUNT
        ) revert InvalidOrder();
        if (order.expiration <= block.timestamp) revert OrderExpired();

        bytes32 orderHash = hashOrder(order);
        if (cancelled[orderHash]) revert OrderIsCancelled();
        if (!SignatureChecker.isValidSignatureNow(order.maker, orderHash, signature)) {
            revert InvalidSignature();
        }
    }

    function _hashOrderStruct(Order calldata order) private pure returns (bytes32) {
        return keccak256(
            abi.encode(
                ORDER_TYPEHASH,
                order.maker,
                order.tokenId,
                order.side,
                order.makerAmount,
                order.takerAmount,
                order.nonce,
                order.expiration
            )
        );
    }
}
